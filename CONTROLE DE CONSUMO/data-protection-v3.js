(function () {
    "use strict";

    let backupSelecionadoV3 = null;
    const $ = id => document.getElementById(id);

    function texto(id, valor) {
        const el = $(id);
        if (el) el.textContent = valor;
    }

    function formatarDataHora(valor) {
        if (!valor) return "—";
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString("pt-BR");
    }

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function garantirSessao() {
        if (!window.supabaseClient) throw new Error("Cliente Supabase não carregado.");
        const { data, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data?.session) {
            location.replace("login.html");
            throw new Error("Sessão não encontrada.");
        }
        return data.session;
    }

    async function sha256(texto) {
        if (!window.crypto?.subtle) throw new Error("Este navegador não suporta verificação SHA-256.");
        const bytes = new TextEncoder().encode(texto);
        const hash = await window.crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function baixarJson(objeto, nomeArquivo) {
        const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async function criarRegistroBackup(origem) {
        await garantirSessao();
        const { data, error } = await window.supabaseClient.rpc("criar_backup_protegido", {
            p_origem: origem || "manual"
        });
        if (error) throw error;
        const registro = Array.isArray(data) ? data[0] : data;
        if (!registro?.conteudo) throw new Error("O banco não retornou o conteúdo do backup.");
        return registro;
    }

    async function montarArquivoBackup(registro) {
        const base = {
            ...registro.conteudo,
            backup_id: registro.id,
            projeto: new URL(SUPABASE_URL).hostname,
            app_versao: window.XBURGUER_VERSAO || null
        };
        const hashArquivo = await sha256(JSON.stringify(base));
        return {
            ...base,
            integridade: {
                algoritmo: "SHA-256",
                hash: hashArquivo,
                hash_servidor: registro.hash_sha256 || null
            }
        };
    }

    async function baixarRegistroBackup(registro) {
        const pacote = await montarArquivoBackup(registro);
        const dataNome = new Date(pacote.exportado_em || Date.now()).toISOString().replace(/[:.]/g, "-");
        baixarJson(pacote, `XBurguer-Consumo-backup-${dataNome}.json`);
        localStorage.setItem("xburguer_ultimo_backup_em", pacote.exportado_em || new Date().toISOString());
        texto("ultimo-backup", formatarDataHora(pacote.exportado_em));
        return pacote;
    }

    function resumoTotais(totais) {
        if (!totais || typeof totais !== "object") return "";
        return [
            `${Number(totais.funcionarios || 0)} funcionários`,
            `${Number(totais.produtos || 0)} produtos`,
            `${Number(totais.consumos || 0)} consumos`,
            `${Number(totais.faltas || 0)} faltas`,
            `${Number(totais.historico_acoes || 0)} ações`
        ].join(" • ");
    }

    function descricaoItemLixeira(item) {
        const d = item?.dados || {};
        if (item.tabela === "funcionarios") return d.nome || "Funcionário";
        if (item.tabela === "produtos") return d.nome || "Produto";
        if (item.tabela === "consumos") return d.descricao || "Consumo";
        if (item.tabela === "faltas") return `${d.motivo || "Falta"}${d.data ? ` • ${d.data}` : ""}`;
        return item.tabela || "Registro";
    }

    function renderizarLixeira(itens) {
        const area = $("lista-lixeira-protegida");
        if (!area) return;
        if (!Array.isArray(itens) || !itens.length) {
            area.innerHTML = '<div class="protecao-vazio">Nenhum registro aguardando recuperação.</div>';
            return;
        }

        area.innerHTML = itens.map(item => `
            <div class="protecao-lixeira-item">
                <div class="protecao-lixeira-info">
                    <strong>${escaparHtml(descricaoItemLixeira(item))}</strong>
                    <span>${escaparHtml(item.tabela)} • excluído em ${escaparHtml(formatarDataHora(item.excluido_em))}</span>
                </div>
                <button type="button" class="btn-config-secundario" onclick="restaurarItemLixeira('${escaparHtml(item.id)}')">Restaurar</button>
            </div>
        `).join("");
    }

    window.atualizarProtecaoDados = async function () {
        try {
            await garantirSessao();
            const [backupsResp, lixeiraResp, auditoriaResp] = await Promise.all([
                window.supabaseClient
                    .from("backups_internos")
                    .select("id,criado_em,origem,hash_sha256,totais", { count: "exact" })
                    .order("criado_em", { ascending: false })
                    .limit(10),
                window.supabaseClient
                    .from("lixeira_dados")
                    .select("id,tabela,registro_id,dados,excluido_em,restaurado_em", { count: "exact" })
                    .is("restaurado_em", null)
                    .order("excluido_em", { ascending: false })
                    .limit(10),
                window.supabaseClient
                    .from("auditoria_dados")
                    .select("id", { count: "exact", head: true })
            ]);

            if (backupsResp.error) throw backupsResp.error;
            if (lixeiraResp.error) throw lixeiraResp.error;
            if (auditoriaResp.error) throw auditoriaResp.error;

            const ultimo = backupsResp.data?.[0] || null;
            texto("backup-interno-ultimo", ultimo ? formatarDataHora(ultimo.criado_em) : "Nenhum");
            texto("backup-interno-total", `${Number(backupsResp.count || 0)} cópia(s)`);
            texto("backup-interno-resumo", ultimo ? resumoTotais(ultimo.totais) : "Aguardando primeiro backup");
            texto("lixeira-protegida", `${Number(lixeiraResp.count || 0)} registro(s)`);
            texto("auditoria-protegida", `${Number(auditoriaResp.count || 0)} alteração(ões)`);
            renderizarLixeira(lixeiraResp.data || []);
        } catch (erro) {
            console.error("Proteção de dados: falha ao atualizar status", erro);
            const area = $("lista-lixeira-protegida");
            if (area) area.innerHTML = '<div class="protecao-vazio">Não foi possível consultar a proteção agora.</div>';
        }
    };

    window.criarBackupInternoAgora = async function () {
        const botao = $("btn-backup-interno");
        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Criando cópia...";
        }
        try {
            const registro = await criarRegistroBackup("manual-interno");
            const status = $("status-backup");
            if (status) status.textContent = `Cópia interna protegida criada em ${formatarDataHora(registro.criado_em)}.`;
            await window.atualizarProtecaoDados();
        } catch (erro) {
            alert("Não foi possível criar a cópia interna.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "🛡️ Criar cópia interna agora";
            }
        }
    };

    window.exportarBackupSupabase = async function () {
        const botao = $("btn-exportar-backup");
        const status = $("status-backup");
        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Protegendo e baixando...";
        }
        if (status) status.textContent = "Criando uma cópia íntegra no banco antes do download...";

        try {
            const registro = await criarRegistroBackup("manual-download");
            const pacote = await baixarRegistroBackup(registro);
            if (status) {
                status.textContent = `Backup protegido concluído • ${resumoTotais(pacote.totais)} • integridade SHA-256 verificada.`;
            }
            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico("Gerou backup protegido", `Backup ${registro.id}`, "💾");
            }
            await window.atualizarProtecaoDados();
        } catch (erro) {
            console.error("Backup protegido:", erro);
            if (status) status.textContent = `Erro ao gerar backup: ${erro.message || erro}`;
            alert("Não foi possível gerar o backup protegido.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "⬇ Criar e baixar backup protegido";
            }
        }
    };

    function validarEstruturaBackup(pacote) {
        if (!pacote || typeof pacote !== "object" || Array.isArray(pacote)) {
            throw new Error("Arquivo JSON inválido.");
        }
        if (pacote.sistema !== "XBurguer Controle") {
            throw new Error("Este arquivo não pertence ao Controle de Consumo.");
        }
        const versao = Number(pacote.versao || 0);
        if (![2, 3].includes(versao)) {
            throw new Error("Versão de backup não suportada.");
        }
        if (!pacote.dados || typeof pacote.dados !== "object") {
            throw new Error("O backup não contém a área de dados.");
        }
        for (const tabela of ["funcionarios", "produtos", "consumos", "faltas", "historico_acoes"]) {
            if (!Array.isArray(pacote.dados[tabela])) {
                throw new Error(`O backup não contém a tabela ${tabela}.`);
            }
        }
    }

    async function validarIntegridadeBackup(pacote) {
        if (!pacote.integridade?.hash) return true;
        const copia = { ...pacote };
        delete copia.integridade;
        const calculado = await sha256(JSON.stringify(copia));
        return calculado === pacote.integridade.hash;
    }

    function resumoBackupArquivo(pacote) {
        const d = pacote.dados;
        return [
            `Backup de ${formatarDataHora(pacote.exportado_em)}`,
            `${d.funcionarios.length} funcionário(s)`,
            `${d.produtos.length} produto(s)`,
            `${d.consumos.length} consumo(s)`,
            `${d.faltas.length} falta(s)`,
            `${d.historico_acoes.length} ação(ões)`
        ].join(" • ");
    }

    window.analisarBackupSelecionado = async function (event) {
        const input = event.target;
        const arquivo = input.files?.[0];
        const resumo = $("resumo-restauracao");
        backupSelecionadoV3 = null;
        if (!arquivo) return;

        try {
            if (resumo) resumo.textContent = "Verificando estrutura e integridade do arquivo...";
            const pacote = JSON.parse(await arquivo.text());
            validarEstruturaBackup(pacote);
            if (!(await validarIntegridadeBackup(pacote))) {
                throw new Error("A assinatura SHA-256 não confere. O arquivo pode estar corrompido ou alterado.");
            }
            backupSelecionadoV3 = pacote;
            if (resumo) {
                resumo.innerHTML = `<strong>Backup válido e verificado.</strong> ${escaparHtml(resumoBackupArquivo(pacote))}<br>` +
                    '<span class="protecao-restauracao-nota">Antes de restaurar, o sistema criará automaticamente uma cópia de segurança do banco atual.</span><br>' +
                    '<button type="button" class="btn-novo-funcionario" style="margin-top:10px" onclick="restaurarBackupSelecionado()">♻️ Recuperar registros ausentes com proteção</button>';
            }
        } catch (erro) {
            console.error("Backup inválido:", erro);
            if (resumo) resumo.textContent = `Backup inválido: ${erro.message || erro}`;
            alert("Não foi possível usar este backup.\n\n" + (erro.message || erro));
        } finally {
            input.value = "";
        }
    };

    window.restaurarBackupSelecionado = async function () {
        if (!backupSelecionadoV3) {
            alert("Selecione primeiro um backup válido.");
            return;
        }

        if (!confirm(
            "RECUPERAÇÃO PROTEGIDA\n\n" +
            "1. O banco atual será copiado antes da recuperação.\n" +
            "2. Somente registros ausentes serão recuperados.\n" +
            "3. Registros atuais não serão substituídos.\n" +
            "4. A recuperação é transacional: se ocorrer um erro, nenhuma parte ficará aplicada pela metade.\n\n" +
            "Deseja continuar?"
        )) return;

        const resumo = $("resumo-restauracao");
        try {
            await garantirSessao();
            if (resumo) resumo.textContent = "Criando cópia de segurança antes da recuperação...";
            await criarRegistroBackup("antes-restauracao");

            if (resumo) resumo.textContent = "Recuperando dados em uma transação protegida...";
            const { data, error } = await window.supabaseClient.rpc("restaurar_backup_seguro", {
                p_dados: backupSelecionadoV3.dados
            });
            if (error) throw error;

            const resultado = data || {};
            await criarRegistroBackup("apos-restauracao");

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Recuperou backup protegido",
                    `${Number(resultado.total || 0)} registro(s) recuperado(s)`,
                    "♻️"
                );
            }

            if (resumo) {
                resumo.innerHTML = `<strong>Recuperação concluída com segurança.</strong> ` +
                    `${Number(resultado.funcionarios || 0)} funcionário(s), ` +
                    `${Number(resultado.produtos || 0)} produto(s), ` +
                    `${Number(resultado.consumos || 0)} consumo(s), ` +
                    `${Number(resultado.faltas || 0)} falta(s) e ` +
                    `${Number(resultado.historico_acoes || 0)} ação(ões) recuperada(s).`;
            }
            backupSelecionadoV3 = null;
            if (window.verificarSistema) await window.verificarSistema();
            await window.atualizarProtecaoDados();
            alert(`Recuperação concluída. ${Number(resultado.total || 0)} registro(s) ausente(s) foram recuperados.`);
        } catch (erro) {
            console.error("Recuperação protegida:", erro);
            if (resumo) resumo.textContent = `A recuperação foi cancelada pelo banco: ${erro.message || erro}`;
            alert("A recuperação não foi aplicada. O banco manteve a consistência.\n\n" + (erro.message || erro));
        }
    };

    window.restaurarItemLixeira = async function (id) {
        if (!id) return;
        if (!confirm("Restaurar este registro da lixeira protegida para o sistema?")) return;
        try {
            await garantirSessao();
            const { data, error } = await window.supabaseClient.rpc("restaurar_da_lixeira", {
                p_lixeira_id: id
            });
            if (error) throw error;
            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Restaurou item da lixeira",
                    `${data?.tabela || "registro"} ${data?.registro_id || ""}`.trim(),
                    "🛡️"
                );
            }
            await window.atualizarProtecaoDados();
            if (window.verificarSistema) await window.verificarSistema();
            alert(data?.status === "restaurado" ? "Registro restaurado com sucesso." : "O registro já estava presente no sistema.");
        } catch (erro) {
            alert("Não foi possível restaurar este registro.\n\n" + (erro.message || erro));
        }
    };

    window.addEventListener("DOMContentLoaded", function () {
        window.atualizarProtecaoDados();
    });
    window.addEventListener("focus", function () {
        window.atualizarProtecaoDados();
    });
})();
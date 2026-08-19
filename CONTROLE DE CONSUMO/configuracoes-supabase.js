(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const TABELAS = [
        "funcionarios",
        "produtos",
        "consumos",
        "faltas",
        "historico_acoes"
    ];

    const CHAVE_ULTIMO_BACKUP = "xburguer_ultimo_backup_em";
    const CHAVE_HISTORICO_PENDENTE = "historico_pendente_xburguer";
    let backupSelecionado = null;

    function definirTexto(id, texto) {
        const el = $(id);
        if (el) el.textContent = texto;
    }

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-configuracoes");
        if (!el) return;
        el.textContent = texto;
        el.classList.remove("status-ok", "status-erro");
        if (tipo === "ok") el.classList.add("status-ok");
        if (tipo === "erro") el.classList.add("status-erro");
    }

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatarDataHora(valor) {
        if (!valor) return "—";
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString("pt-BR");
    }

    async function garantirSessao() {
        if (!window.supabaseClient) {
            throw new Error("Cliente Supabase não carregado.");
        }

        const { data, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;

        if (!data?.session) {
            location.replace("login.html");
            throw new Error("Sessão não encontrada.");
        }

        return data.session;
    }

    function atualizarUsuarioTopo(session) {
        const user = session?.user;
        const saudacao = document.querySelector(".saudacao");
        const cargo = document.querySelector(".cargo");
        const avatar = document.querySelector(".avatar-admin");

        if (saudacao) saudacao.textContent = "X-Burguer";
        if (cargo) cargo.textContent = "Sistema de Gestão";
        if (avatar) avatar.textContent = "X";

        return user;
    }

    function contarPendenciasLocais() {
        try {
            const lista = JSON.parse(
                localStorage.getItem(CHAVE_HISTORICO_PENDENTE) || "[]"
            );
            return Array.isArray(lista) ? lista.length : 0;
        } catch (_) {
            return 0;
        }
    }

    function atualizarPendenciasTela() {
        const qtd = contarPendenciasLocais();
        definirTexto(
            "config-pendencias",
            qtd ? `${qtd} ação(ões) aguardando envio` : "Nenhuma"
        );
    }

    async function contarTabela(tabela) {
        const { count, error } = await window.supabaseClient
            .from(tabela)
            .select("id", { count: "exact", head: true });

        if (error) throw error;
        return Number(count || 0);
    }

    window.verificarSistema = async function (manual = false) {
        const btn = $("btn-verificar-sistema");

        if (btn) {
            btn.disabled = true;
            btn.dataset.textoOriginal = btn.textContent;
            btn.textContent = "Verificando...";
        }

        definirStatus("Verificando conexão e banco...");

        try {
            const session = await garantirSessao();
            atualizarUsuarioTopo(session);

            const [funcionarios, produtos, consumos, faltas, historico] =
                await Promise.all([
                    contarTabela("funcionarios"),
                    contarTabela("produtos"),
                    contarTabela("consumos"),
                    contarTabela("faltas"),
                    contarTabela("historico_acoes")
                ]);

            definirTexto("check-funcionarios", `${funcionarios.toLocaleString("pt-BR")} registro(s)`);
            definirTexto("check-produtos", `${produtos.toLocaleString("pt-BR")} registro(s)`);
            definirTexto("check-consumos", `${consumos.toLocaleString("pt-BR")} registro(s)`);
            definirTexto("check-faltas", `${faltas.toLocaleString("pt-BR")} registro(s)`);
            definirTexto("check-historico", `${historico.toLocaleString("pt-BR")} registro(s)`);

            const agora = new Date();
            definirTexto("config-verificado-em", agora.toLocaleString("pt-BR"));

            const host = new URL(SUPABASE_URL).hostname;
            definirTexto("config-projeto", host);

            atualizarPendenciasTela();
            definirStatus("Sistema conectado e banco acessível.", "ok");
        } catch (erro) {
            console.error("Falha na verificação do sistema:", erro);
            definirStatus(`Erro: ${erro.message || erro}`, "erro");

            if (manual) {
                alert(
                    "Não foi possível verificar o sistema.\n\n" +
                    (erro.message || erro)
                );
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = btn.dataset.textoOriginal || "↻ Verificar agora";
            }
        }
    };

    async function lerTabelaCompleta(tabela) {
        const pagina = 1000;
        let inicio = 0;
        const todos = [];

        while (true) {
            const { data, error } = await window.supabaseClient
                .from(tabela)
                .select("*")
                .range(inicio, inicio + pagina - 1);

            if (error) throw error;

            const lote = Array.isArray(data) ? data : [];
            todos.push(...lote);

            if (lote.length < pagina) break;
            inicio += pagina;
        }

        return todos;
    }

    async function sha256(texto) {
        if (!window.crypto?.subtle) return null;

        const bytes = new TextEncoder().encode(texto);
        const hash = await window.crypto.subtle.digest("SHA-256", bytes);

        return [...new Uint8Array(hash)]
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    function baixarJson(objeto, nomeArquivo) {
        const blob = new Blob(
            [JSON.stringify(objeto, null, 2)],
            { type: "application/json;charset=utf-8" }
        );

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.exportarBackupSupabase = async function () {
        const btn = $("btn-exportar-backup");
        const status = $("status-backup");

        if (btn) {
            btn.disabled = true;
            btn.dataset.textoOriginal = btn.textContent;
            btn.textContent = "Gerando backup...";
        }

        if (status) status.textContent = "Lendo os dados diretamente do Supabase...";

        try {
            const session = await garantirSessao();

            const [
                funcionarios,
                produtos,
                consumos,
                faltas,
                historico_acoes
            ] = await Promise.all([
                lerTabelaCompleta("funcionarios"),
                lerTabelaCompleta("produtos"),
                lerTabelaCompleta("consumos"),
                lerTabelaCompleta("faltas"),
                lerTabelaCompleta("historico_acoes")
            ]);

            const pacoteBase = {
                sistema: "XBurguer Controle",
                formato: "backup-supabase",
                versao: 2,
                exportado_em: new Date().toISOString(),
                projeto: new URL(SUPABASE_URL).hostname,
                usuario_exportacao: session.user?.email || null,
                dados: {
                    funcionarios,
                    produtos,
                    consumos,
                    faltas,
                    historico_acoes
                }
            };

            const hash = await sha256(JSON.stringify(pacoteBase));
            const pacote = {
                ...pacoteBase,
                integridade: {
                    algoritmo: hash ? "SHA-256" : "indisponível",
                    hash
                }
            };

            const dataNome = new Date().toISOString().replace(/[:.]/g, "-");
            baixarJson(
                pacote,
                `backup-xburguer-${dataNome}.json`
            );

            localStorage.setItem(
                CHAVE_ULTIMO_BACKUP,
                pacoteBase.exportado_em
            );

            definirTexto(
                "ultimo-backup",
                formatarDataHora(pacoteBase.exportado_em)
            );

            const total =
                funcionarios.length +
                produtos.length +
                consumos.length +
                faltas.length +
                historico_acoes.length;

            if (status) {
                status.textContent =
                    `Backup concluído: ${total.toLocaleString("pt-BR")} registro(s) incluído(s).`;
            }

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Gerou backup",
                    `Backup completo com ${total} registro(s)`,
                    "💾"
                );
            }
        } catch (erro) {
            console.error("Erro ao gerar backup:", erro);

            if (status) {
                status.textContent =
                    `Erro ao gerar backup: ${erro.message || erro}`;
            }

            alert(
                "Não foi possível gerar o backup.\n\n" +
                (erro.message || erro)
            );
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent =
                    btn.dataset.textoOriginal || "⬇ Baixar backup agora";
            }
        }
    };

    async function validarIntegridadeBackup(pacote) {
        if (!pacote.integridade?.hash) return true;

        const copia = { ...pacote };
        delete copia.integridade;

        const hashCalculado = await sha256(JSON.stringify(copia));

        if (!hashCalculado) {
            throw new Error(
                "Este navegador não conseguiu verificar a assinatura SHA-256 do backup."
            );
        }

        return hashCalculado === pacote.integridade.hash;
    }

    function validarEstruturaBackup(pacote) {
        if (!pacote || typeof pacote !== "object") {
            throw new Error("Arquivo JSON inválido.");
        }

        if (pacote.sistema !== "XBurguer Controle") {
            throw new Error("Este arquivo não foi identificado como um backup do X-Burguer.");
        }

        if (Number(pacote.versao) !== 2) {
            throw new Error("Versão de backup não suportada por esta versão do sistema.");
        }

        if (!pacote.dados || typeof pacote.dados !== "object") {
            throw new Error("O backup não contém a área de dados.");
        }

        for (const tabela of TABELAS) {
            if (!Array.isArray(pacote.dados[tabela])) {
                throw new Error(`O backup não contém a tabela ${tabela}.`);
            }
        }
    }

    function resumoBackup(pacote) {
        const d = pacote.dados;
        return [
            `Backup de ${formatarDataHora(pacote.exportado_em)}`,
            `${d.funcionarios.length} funcionário(s)`,
            `${d.produtos.length} produto(s)`,
            `${d.consumos.length} consumo(s)`,
            `${d.faltas.length} falta(s)`,
            `${d.historico_acoes.length} ação(ões) de histórico`
        ].join(" • ");
    }

    window.analisarBackupSelecionado = async function (event) {
        const input = event.target;
        const arquivo = input.files?.[0];
        const resumo = $("resumo-restauracao");

        backupSelecionado = null;

        if (!arquivo) return;

        try {
            if (resumo) resumo.textContent = "Analisando backup...";

            const texto = await arquivo.text();
            const pacote = JSON.parse(texto);

            validarEstruturaBackup(pacote);

            const integra = await validarIntegridadeBackup(pacote);
            if (!integra) {
                throw new Error(
                    "A verificação de integridade falhou. O arquivo pode ter sido alterado ou corrompido."
                );
            }

            backupSelecionado = pacote;

            if (resumo) {
                resumo.innerHTML =
                    `<strong>Backup válido.</strong> ${escaparHtml(resumoBackup(pacote))}<br>` +
                    `<button type="button" class="btn-novo-funcionario" style="margin-top:10px;" onclick="restaurarBackupSelecionado()">Recuperar registros ausentes</button>`;
            }
        } catch (erro) {
            console.error("Backup inválido:", erro);

            if (resumo) {
                resumo.textContent =
                    `Backup inválido: ${erro.message || erro}`;
            }

            alert(
                "Não foi possível usar este backup.\n\n" +
                (erro.message || erro)
            );
        } finally {
            input.value = "";
        }
    };

    async function idsExistentes(tabela) {
        const registros = await lerTabelaCompleta(tabela);
        return new Set(registros.map(item => item.id));
    }

    async function inserirEmLotes(tabela, registros, tamanho = 200) {
        let inseridos = 0;

        for (let i = 0; i < registros.length; i += tamanho) {
            const lote = registros.slice(i, i + tamanho);

            const { error } = await window.supabaseClient
                .from(tabela)
                .insert(lote);

            if (error) throw error;
            inseridos += lote.length;
        }

        return inseridos;
    }

    function prepararFuncionarios(registros, existentes) {
        return registros
            .filter(r => r?.id && !existentes.has(r.id))
            .map(r => ({
                id: r.id,
                nome: r.nome,
                cargo: r.cargo || "",
                salario: r.salario ?? null,
                status: r.status === "Inativo" ? "Inativo" : "Ativo",
                created_at: r.created_at || new Date().toISOString(),
                updated_at: r.updated_at || r.created_at || new Date().toISOString()
            }));
    }

    function prepararProdutos(registros, existentes) {
        return registros
            .filter(r => r?.id && !existentes.has(r.id))
            .map(r => ({
                id: r.id,
                nome: r.nome,
                preco: Number(r.preco || 0),
                ativo: r.ativo !== false,
                created_at: r.created_at || new Date().toISOString(),
                updated_at: r.updated_at || r.created_at || new Date().toISOString()
            }));
    }

    function prepararConsumos(registros, existentes) {
        return registros
            .filter(r => r?.id && !existentes.has(r.id))
            .map(r => ({
                id: r.id,
                funcionario_id: r.funcionario_id,
                produto_id: r.produto_id || null,
                tipo: r.tipo === "avulso" ? "avulso" : "produto",
                descricao: r.descricao || "Sem descrição",
                observacao: r.observacao || null,
                quantidade: Math.max(1, parseInt(r.quantidade, 10) || 1),
                preco_unitario: Number(r.preco_unitario || 0),
                data_hora: r.data_hora || new Date().toISOString(),
                created_at: r.created_at || r.data_hora || new Date().toISOString()
            }));
    }

    function prepararFaltas(registros, existentes) {
        return registros
            .filter(r => r?.id && !existentes.has(r.id))
            .map(r => ({
                id: r.id,
                funcionario_id: r.funcionario_id,
                data: r.data,
                motivo: r.motivo || "",
                observacao: r.observacao || null,
                created_at: r.created_at || new Date().toISOString()
            }));
    }

    window.restaurarBackupSelecionado = async function () {
        if (!backupSelecionado) {
            alert("Selecione primeiro um backup válido.");
            return;
        }

        const d = backupSelecionado.dados;

        if (!confirm(
            "RECUPERAÇÃO DE BACKUP\n\n" +
            "O sistema vai recuperar apenas registros operacionais que não existem mais no banco, usando o ID original.\n\n" +
            "Registros atuais não serão apagados nem substituídos.\n" +
            "O histórico antigo não será regravado por esta tela.\n\n" +
            "Deseja continuar?"
        )) {
            return;
        }

        const resumo = $("resumo-restauracao");

        try {
            await garantirSessao();

            if (resumo) resumo.textContent = "Comparando o backup com o banco atual...";

            // Ordem necessária por causa das chaves estrangeiras.
            const idsFunc = await idsExistentes("funcionarios");
            const funcNovos = prepararFuncionarios(d.funcionarios, idsFunc);

            if (resumo) resumo.textContent = "Recuperando funcionários...";
            const nFunc = await inserirEmLotes("funcionarios", funcNovos);

            const idsProd = await idsExistentes("produtos");
            const prodNovos = prepararProdutos(d.produtos, idsProd);

            if (resumo) resumo.textContent = "Recuperando produtos...";
            const nProd = await inserirEmLotes("produtos", prodNovos);

            const idsCons = await idsExistentes("consumos");
            const consNovos = prepararConsumos(d.consumos, idsCons);

            if (resumo) resumo.textContent = "Recuperando consumos...";
            const nCons = await inserirEmLotes("consumos", consNovos);

            const idsFaltas = await idsExistentes("faltas");
            const faltasNovas = prepararFaltas(d.faltas, idsFaltas);

            if (resumo) resumo.textContent = "Recuperando faltas...";
            const nFaltas = await inserirEmLotes("faltas", faltasNovas);

            const total = nFunc + nProd + nCons + nFaltas;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Recuperou backup",
                    `Recuperação de ${total} registro(s) ausente(s): ` +
                    `${nFunc} funcionário(s), ${nProd} produto(s), ${nCons} consumo(s), ${nFaltas} falta(s)`,
                    "♻️"
                );
            }

            if (resumo) {
                resumo.innerHTML =
                    `<strong>Recuperação concluída.</strong> ` +
                    `${nFunc} funcionário(s), ${nProd} produto(s), ` +
                    `${nCons} consumo(s) e ${nFaltas} falta(s) recuperado(s). ` +
                    `O histórico do arquivo permaneceu somente no backup para preservar a auditoria.`;
            }

            await verificarSistema();

            alert(
                "Recuperação concluída com sucesso.\n\n" +
                `Registros recuperados: ${total}.`
            );
        } catch (erro) {
            console.error("Erro ao recuperar backup:", erro);

            if (resumo) {
                resumo.textContent =
                    `Erro durante a recuperação: ${erro.message || erro}`;
            }

            alert(
                "A recuperação não pôde ser concluída.\n\n" +
                (erro.message || erro)
            );
        }
    };

    window.sincronizarPendenciasManual = async function () {
        try {
            await garantirSessao();

            if (!window.sincronizarHistoricoPendente) {
                throw new Error("Função de sincronização indisponível.");
            }

            const antes = contarPendenciasLocais();
            const enviados = await window.sincronizarHistoricoPendente();

            atualizarPendenciasTela();

            if (antes === 0) {
                alert("Não havia ações pendentes para sincronizar.");
            } else if (enviados > 0) {
                alert(`${enviados} ação(ões) pendente(s) sincronizada(s).`);
            } else {
                alert(
                    "As pendências continuam armazenadas localmente. " +
                    "Verifique a conexão com a internet e tente novamente."
                );
            }
        } catch (erro) {
            alert(
                "Não foi possível sincronizar as pendências.\n\n" +
                (erro.message || erro)
            );
        }
    };

    window.addEventListener("DOMContentLoaded", function () {
        const ultimo = localStorage.getItem(CHAVE_ULTIMO_BACKUP);
        definirTexto(
            "ultimo-backup",
            ultimo ? formatarDataHora(ultimo) : "Nenhum registrado"
        );

        atualizarPendenciasTela();
        verificarSistema();
    });

    window.addEventListener("focus", function () {
        atualizarPendenciasTela();
    });
})();

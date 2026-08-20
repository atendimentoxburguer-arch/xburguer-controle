(function () {
    "use strict";

    let listaFaltas = [];
    let listaFuncionarios = [];
    let faltaExclusaoId = null;

    const $ = (id) => document.getElementById(id);

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-faltas-banco");
        if (!el) return;

        el.textContent = texto;
        if (tipo === "erro") el.style.color = "#b00020";
        else if (tipo === "ok") el.style.color = "#2e7d32";
        else el.style.color = "#777";
    }

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function obterFuncionarioPorId(id) {
        return listaFuncionarios.find(f => f.id === id) || null;
    }

    function normalizarNome(valor) {
        return String(valor || "").trim().toLocaleLowerCase("pt-BR");
    }

    function dataBancoParaTela(valor) {
        if (!valor) return "—";

        const iso = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return String(valor);

        return d.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    }

    function dataAntigaParaBanco(valor) {
        if (!valor) return null;

        const texto = String(valor).trim();

        const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

        const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (br) return `${br[3]}-${br[2]}-${br[1]}`;

        const d = new Date(texto);
        if (Number.isNaN(d.getTime())) return null;

        const ano = d.getFullYear();
        const mes = String(d.getMonth() + 1).padStart(2, "0");
        const dia = String(d.getDate()).padStart(2, "0");
        return `${ano}-${mes}-${dia}`;
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

    function criarBackupPreSupabaseSeNecessario() {
        if (localStorage.getItem("faltas_xburguer_backup_pre_supabase")) return;

        const bruto = localStorage.getItem("faltas_xburguer");
        if (!bruto) return;

        try {
            const dados = JSON.parse(bruto);
            if (Array.isArray(dados) && dados.length) {
                localStorage.setItem(
                    "faltas_xburguer_backup_pre_supabase",
                    JSON.stringify(dados)
                );
            }
        } catch (_) {}
    }

    function salvarEspelhoLocal() {
        // Compatibilidade temporária com Dashboard e Relatórios.
        // O Supabase é a fonte principal da página Faltas.
        const espelho = listaFaltas.map(falta => {
            const funcionario = obterFuncionarioPorId(falta.funcionario_id);

            return {
                id: falta.id,
                funcionarioId: falta.funcionario_id,
                funcionario: funcionario?.nome || "Funcionário removido",
                data: dataBancoParaTela(falta.data),
                motivo: falta.motivo || "—",
                obs: falta.observacao || "—",
                observacao: falta.observacao || ""
            };
        });

        localStorage.setItem("faltas_xburguer", JSON.stringify(espelho));
    }

    async function carregarDadosBase() {
        const [respFuncionarios, respFaltas] = await Promise.all([
            window.supabaseClient
                .from("funcionarios")
                .select("id,nome,cargo,status")
                .order("nome", { ascending: true }),

            window.supabaseClient
                .from("faltas")
                .select("id,funcionario_id,data,motivo,observacao,created_at")
                .order("data", { ascending: false })
        ]);

        if (respFuncionarios.error) throw respFuncionarios.error;
        if (respFaltas.error) throw respFaltas.error;

        listaFuncionarios = Array.isArray(respFuncionarios.data)
            ? respFuncionarios.data
            : [];

        listaFaltas = Array.isArray(respFaltas.data)
            ? respFaltas.data
            : [];
    }

    async function carregarTudo() {
        definirStatus("Carregando faltas do banco de dados...");

        try {
            await garantirSessao();
            await carregarDadosBase();

            carregarSelects();
            salvarEspelhoLocal();
            atualizarTabelaFaltas();

            definirStatus(
                listaFaltas.length
                    ? `Banco de dados conectado • ${listaFaltas.length} falta(s) carregada(s)`
                    : "Banco de dados conectado • nenhuma falta registrada ainda",
                "ok"
            );

            verificarDadosAntigos();
        } catch (erro) {
            console.error("Erro ao carregar Faltas:", erro);
            definirStatus(
                `Erro ao carregar do banco: ${erro.message || erro}`,
                "erro"
            );

            if (!window.XBURGUER_ATUALIZACAO_SILENCIOSA) {
                alert(
                    "Não foi possível carregar as faltas do banco de dados.\n\n" +
                    (erro.message || erro)
                );
            }
        }
    }

    window.carregarSelects = function () {
        const selectModal = $("cad-func-falta");
        const selectFiltro = $("filtro-funcionario-falta");

        if (!selectModal || !selectFiltro) return;

        const filtroAtual = selectFiltro.value || "todos";

        selectModal.innerHTML = '<option value="">Selecione...</option>';
        selectFiltro.innerHTML = '<option value="todos">Todos os funcionários</option>';

        listaFuncionarios.forEach(funcionario => {
            const opcaoFiltro = document.createElement("option");
            opcaoFiltro.value = funcionario.id;
            opcaoFiltro.textContent = funcionario.nome;
            selectFiltro.appendChild(opcaoFiltro);

            if (funcionario.status === "Ativo") {
                const opcaoModal = document.createElement("option");
                opcaoModal.value = funcionario.id;
                opcaoModal.textContent = funcionario.nome;
                selectModal.appendChild(opcaoModal);
            }
        });

        if ([...selectFiltro.options].some(o => o.value === filtroAtual)) {
            selectFiltro.value = filtroAtual;
        }
    };

    window.abrirModalFalta = function () {
        carregarSelects();

        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        const dia = String(hoje.getDate()).padStart(2, "0");

        $("cad-data-falta").value = `${ano}-${mes}-${dia}`;
        $("cad-func-falta").value = "";
        $("cad-motivo-falta").value = "";
        $("cad-obs-falta").value = "";
        $("modal-falta").style.display = "flex";
    };

    window.fecharModalFalta = function () {
        $("modal-falta").style.display = "none";
    };

    async function registrarHistoricoLocal(acao, detalhes, icone) {
        // O Histórico será migrado ao Supabase em etapa própria.
        if (window.registrarNoHistorico) {
            window.registrarNoHistorico(acao, detalhes, icone);
        }
    }

    window.salvarFalta = async function (event) {
        event.preventDefault();

        const funcionarioId = $("cad-func-falta").value;
        const data = $("cad-data-falta").value;
        const motivo = $("cad-motivo-falta").value.trim();
        const observacao = $("cad-obs-falta").value.trim();
        const funcionario = obterFuncionarioPorId(funcionarioId);
        const botao = event.submitter || document.querySelector(".btn-salvar-modal");

        if (!funcionarioId || !funcionario || funcionario.status !== "Ativo") {
            alert("Selecione um funcionário ativo.");
            return;
        }

        if (!data) {
            alert("Informe a data da falta.");
            return;
        }

        const payload = {
            funcionario_id: funcionarioId,
            data,
            motivo: motivo || "",
            observacao: observacao || null
        };

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando...";
        }

        definirStatus("Salvando falta no banco de dados...");

        try {
            await garantirSessao();

            const { data: salva, error } = await window.supabaseClient
                .from("faltas")
                .insert(payload)
                .select("id,funcionario_id,data,motivo,observacao,created_at")
                .single();

            if (error) throw error;

            await registrarHistoricoLocal(
                "Registrou falta",
                `${funcionario.nome} - ${motivo || "Sem motivo informado"} - ${dataBancoParaTela(salva?.data || data)}`,
                "📅"
            );

            fecharModalFalta();
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao salvar falta:", erro);
            definirStatus(`Erro ao salvar: ${erro.message || erro}`, "erro");

            alert(
                "Não foi possível salvar a falta.\n\n" +
                (erro.message || erro)
            );
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "💾 Salvar";
            }
        }
    };

    window.abrirModalExcluir = function (id) {
        const falta = listaFaltas.find(item => item.id === id);
        if (!falta) return;

        const funcionario = obterFuncionarioPorId(falta.funcionario_id);
        faltaExclusaoId = id;
        $("excluir-index").value = id;

        const textoAviso = document.querySelector("#modal-excluir .texto-aviso-excluir");
        if (textoAviso) {
            textoAviso.innerHTML =
                `Excluir a falta de <strong>${escaparHtml(funcionario?.nome || "funcionário")}</strong> ` +
                `do dia <strong>${escaparHtml(dataBancoParaTela(falta.data))}</strong>? ` +
                "Esta ação não pode ser desfeita.";
        }

        $("modal-excluir").style.display = "flex";
    };

    window.fecharModalExcluir = function () {
        faltaExclusaoId = null;
        $("modal-excluir").style.display = "none";
    };

    window.confirmarExclusao = async function () {
        const id = faltaExclusaoId || $("excluir-index").value;
        const removida = listaFaltas.find(item => item.id === id);

        if (!id || !removida) return;

        const funcionario = obterFuncionarioPorId(removida.funcionario_id);
        const botao = document.querySelector(".btn-excluir-modal");

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Excluindo...";
        }

        definirStatus("Excluindo falta do banco de dados...");

        try {
            await garantirSessao();

            const { error } = await window.supabaseClient
                .from("faltas")
                .delete()
                .eq("id", id);

            if (error) throw error;

            await registrarHistoricoLocal(
                "Excluiu falta",
                `${funcionario?.nome || "Funcionário"} - ${dataBancoParaTela(removida.data)}`,
                "🗑️"
            );

            fecharModalExcluir();
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao excluir falta:", erro);
            definirStatus(`Erro ao excluir: ${erro.message || erro}`, "erro");

            alert(
                "Não foi possível excluir a falta.\n\n" +
                (erro.message || erro)
            );
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "Excluir";
            }
        }
    };

    window.atualizarTabelaFaltas = function () {
        const corpo = $("corpo-tabela-falta");
        const rodape = $("contador-rodape-falta");
        const contadorTopo = $("contador-topo-faltas");
        const filtro = $("filtro-funcionario-falta")?.value || "todos";

        if (!corpo || !rodape || !contadorTopo) return;

        const filtradas = listaFaltas.filter(falta =>
            filtro === "todos" || falta.funcionario_id === filtro
        );

        if (!filtradas.length) {
            corpo.innerHTML = `
                <tr id="linha-vazia">
                    <td colspan="5" class="tabela-vazia">
                        <span class="ponto-vermelho-vazio"></span>
                        Nenhum registro de falta
                    </td>
                </tr>`;

            rodape.textContent = "Total: 0 registros";
            contadorTopo.textContent = "Total: 0 registros";
            return;
        }

        corpo.innerHTML = filtradas.map(falta => {
            const funcionario = obterFuncionarioPorId(falta.funcionario_id);
            const nome = funcionario?.nome || "Funcionário removido";
            const inicial = nome.charAt(0).toUpperCase();
            const idSeguro = JSON.stringify(falta.id);

            return `
                <tr>
                    <td style="text-align:left;display:flex;align-items:center;gap:10px;padding-left:20px;">
                        <div class="avatar-letra" style="width:30px;height:30px;font-size:13px;">${escaparHtml(inicial)}</div>
                        <span style="font-weight:700;color:#333;">${escaparHtml(nome)}</span>
                    </td>
                    <td style="text-align:left;">📅 ${escaparHtml(dataBancoParaTela(falta.data))}</td>
                    <td style="text-align:left;">${escaparHtml(falta.motivo || "—")}</td>
                    <td style="text-align:left;color:#666;">${escaparHtml(falta.observacao || "—")}</td>
                    <td>
                        <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
                            <button type="button" aria-label="Excluir" onclick='abrirModalExcluir(${idSeguro})' title="Excluir"
                                style="border:none;background:none;cursor:pointer;font-size:16px;">🗑️</button>
                        </div>
                    </td>
                </tr>`;
        }).join("");

        rodape.textContent = `Total: ${filtradas.length} registro(s)`;
        contadorTopo.textContent = `Total: ${filtradas.length} registros`;
    };

    function verificarDadosAntigos() {
        // Migração antiga encerrada: backups locais permanecem preservados, sem aviso na interface.
        return;
    }

    async function importarFaltasAntigas() {
        let antigas = [];

        try {
            antigas = JSON.parse(
                localStorage.getItem("faltas_xburguer_backup_pre_supabase") || "[]"
            );
        } catch (_) {}

        if (!antigas.length) {
            alert("Não há faltas antigas para importar.");
            return;
        }

        if (!confirm(
            `Importar ${antigas.length} falta(s) do backup local para o Supabase?\n\n` +
            "O sistema relacionará os registros aos funcionários já cadastrados no banco."
        )) {
            return;
        }

        definirStatus("Preparando importação das faltas antigas...");

        try {
            await garantirSessao();
            await carregarDadosBase();

            const funcionariosPorNome = new Map(
                listaFuncionarios.map(f => [normalizarNome(f.nome), f])
            );

            const existentes = new Set(
                listaFaltas.map(f => [
                    f.funcionario_id,
                    f.data,
                    normalizarNome(f.motivo),
                    normalizarNome(f.observacao)
                ].join("|"))
            );

            const novas = [];
            let ignoradasSemFuncionario = 0;
            let ignoradasDataInvalida = 0;
            let duplicadas = 0;

            for (const item of antigas) {
                const nomeFuncionario =
                    item.funcionario ||
                    item.nomeFuncionario ||
                    item.nome ||
                    "";

                const funcionario = funcionariosPorNome.get(
                    normalizarNome(nomeFuncionario)
                );

                if (!funcionario) {
                    ignoradasSemFuncionario++;
                    continue;
                }

                const data = dataAntigaParaBanco(
                    item.data || item.dataFalta || item.data_falta
                );

                if (!data) {
                    ignoradasDataInvalida++;
                    continue;
                }

                const motivo = String(item.motivo || "").trim();
                const observacao = String(
                    item.observacao ?? item.obs ?? ""
                ).trim();

                const chave = [
                    funcionario.id,
                    data,
                    normalizarNome(motivo),
                    normalizarNome(observacao)
                ].join("|");

                if (existentes.has(chave)) {
                    duplicadas++;
                    continue;
                }

                existentes.add(chave);

                novas.push({
                    funcionario_id: funcionario.id,
                    data,
                    motivo,
                    observacao: observacao || null
                });
            }

            if (novas.length) {
                const { error } = await window.supabaseClient
                    .from("faltas")
                    .insert(novas);

                if (error) throw error;
            }

            localStorage.setItem("faltas_migracao_supabase_resolvida", "1");

            let mensagem = `${novas.length} falta(s) importada(s) com sucesso.`;
            if (duplicadas) {
                mensagem += `\n${duplicadas} registro(s) já existiam e foram ignorados.`;
            }
            if (ignoradasSemFuncionario) {
                mensagem += `\n${ignoradasSemFuncionario} registro(s) foram ignorados porque o funcionário não foi encontrado.`;
            }
            if (ignoradasDataInvalida) {
                mensagem += `\n${ignoradasDataInvalida} registro(s) tinham data inválida.`;
            }

            alert(mensagem);
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao importar faltas antigas:", erro);
            definirStatus(`Erro na importação: ${erro.message || erro}`, "erro");

            alert(
                "Não foi possível importar as faltas antigas.\n\n" +
                (erro.message || erro)
            );
        }
    }

    window.addEventListener("DOMContentLoaded", function () {
        // O backup é criado antes do primeiro carregamento do banco substituir
        // o espelho local utilizado pelas telas ainda não migradas.
        criarBackupPreSupabaseSeNecessario();
        carregarTudo();
    });

    window.recarregarFaltasDoBanco = carregarTudo;
})();

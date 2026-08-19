(function () {
    "use strict";

    let listaFuncionarios = [];
    let funcionarioExclusaoId = null;

    const $ = (id) => document.getElementById(id);

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-funcionarios-banco");
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

    function salarioParaNumero(valor) {
        if (valor === null || valor === undefined || valor === "") return null;
        const numero = window.formatarMoeda ? window.formatarMoeda(valor) : Number(valor);
        return Number.isFinite(numero) ? numero : null;
    }

    function salarioParaTela(valor) {
        if (valor === null || valor === undefined || valor === "") return "—";
        if (window.moedaBR) return window.moedaBR(valor);
        return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    function salarioParaCampo(valor) {
        if (valor === null || valor === undefined || valor === "") return "";
        return Number(valor).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function salvarEspelhoLocal() {
        // Compatibilidade temporária com Consumos/Faltas enquanto essas páginas
        // ainda não foram migradas. O banco Supabase é a fonte principal.
        const espelho = listaFuncionarios.map(f => ({
            id: f.id,
            nome: f.nome,
            cargo: f.cargo,
            salario: salarioParaTela(f.salario),
            status: f.status
        }));
        localStorage.setItem("funcionarios_xburguer", JSON.stringify(espelho));
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

    async function carregarFuncionarios() {
        definirStatus("Carregando funcionários do banco de dados...");

        try {
            await garantirSessao();

            const { data, error } = await window.supabaseClient
                .from("funcionarios")
                .select("id,nome,cargo,salario,status,created_at,updated_at")
                .order("nome", { ascending: true });

            if (error) throw error;

            listaFuncionarios = Array.isArray(data) ? data : [];
            salvarEspelhoLocal();
            atualizarTabela();

            definirStatus(
                listaFuncionarios.length
                    ? `Banco de dados conectado • ${listaFuncionarios.length} funcionário(s) carregado(s)`
                    : "Banco de dados conectado • nenhum funcionário cadastrado ainda",
                "ok"
            );

            verificarDadosAntigos();
        } catch (erro) {
            console.error("Erro ao carregar funcionários:", erro);
            definirStatus(`Erro ao carregar do banco: ${erro.message || erro}`, "erro");
            alert("Não foi possível carregar os funcionários do banco de dados.\n\n" + (erro.message || erro));
        }
    }

    function verificarDadosAntigos() {
        // Migração antiga encerrada: backups locais permanecem preservados, sem aviso na interface.
        return;
    }

    function criarBackupPreSupabaseSeNecessario() {
        if (localStorage.getItem("funcionarios_xburguer_backup_pre_supabase")) return;

        const bruto = localStorage.getItem("funcionarios_xburguer");
        if (!bruto) return;

        try {
            const dados = JSON.parse(bruto);
            if (Array.isArray(dados) && dados.length) {
                localStorage.setItem("funcionarios_xburguer_backup_pre_supabase", JSON.stringify(dados));
            }
        } catch (_) {}
    }

    async function importarFuncionariosAntigos() {
        let antigos;
        try {
            antigos = JSON.parse(localStorage.getItem("funcionarios_xburguer_backup_pre_supabase") || "[]");
        } catch (_) {
            antigos = [];
        }

        if (!antigos.length) {
            alert("Não há funcionários antigos para importar.");
            return;
        }

        if (!confirm(`Importar ${antigos.length} funcionário(s) do backup local para o Supabase?\n\nRegistros com mesmo nome e cargo já existentes serão ignorados.`)) {
            return;
        }

        definirStatus("Importando funcionários antigos...");

        try {
            await garantirSessao();

            const existentes = new Set(
                listaFuncionarios.map(f =>
                    `${String(f.nome).trim().toLowerCase()}|${String(f.cargo).trim().toLowerCase()}`
                )
            );

            const novos = antigos
                .filter(f => f && f.nome)
                .filter(f => {
                    const chave = `${String(f.nome).trim().toLowerCase()}|${String(f.cargo || "").trim().toLowerCase()}`;
                    return !existentes.has(chave);
                })
                .map(f => ({
                    nome: String(f.nome).trim(),
                    cargo: String(f.cargo || "").trim(),
                    salario: f.salario === "—" ? null : salarioParaNumero(f.salario),
                    status: f.status === "Inativo" ? "Inativo" : "Ativo"
                }));

            if (novos.length) {
                const { error } = await window.supabaseClient
                    .from("funcionarios")
                    .insert(novos);

                if (error) throw error;
            }

            localStorage.setItem("funcionarios_migracao_supabase_resolvida", "1");
            alert(
                novos.length
                    ? `${novos.length} funcionário(s) importado(s) com sucesso.`
                    : "Nenhum registro novo precisou ser importado."
            );
            await carregarFuncionarios();
        } catch (erro) {
            console.error("Erro ao importar backup:", erro);
            definirStatus(`Erro na importação: ${erro.message || erro}`, "erro");
            alert("Não foi possível importar os funcionários antigos.\n\n" + (erro.message || erro));
        }
    }

    window.abrirModalCadastro = function () {
        $("modal-titulo").innerText = "➕ Novo Funcionário";
        $("edit-index").value = "";
        $("cad-nome").value = "";
        $("cad-cargo").value = "";
        $("cad-salario").value = "";
        document.querySelector('input[name="status"][value="Ativo"]').checked = true;
        $("modal-funcionario").style.display = "flex";
    };

    window.abrirModalEdicao = function (id) {
        const f = listaFuncionarios.find(item => item.id === id);
        if (!f) return;

        $("modal-titulo").innerText = "✏️ Editar Funcionário";
        $("edit-index").value = f.id;
        $("cad-nome").value = f.nome || "";
        $("cad-cargo").value = f.cargo || "";
        $("cad-salario").value = salarioParaCampo(f.salario);

        const status = f.status === "Inativo" ? "Inativo" : "Ativo";
        document.querySelector(`input[name="status"][value="${status}"]`).checked = true;

        $("modal-funcionario").style.display = "flex";
    };

    window.fecharModalCadastro = function () {
        $("modal-funcionario").style.display = "none";
    };

    window.salvarFuncionario = async function (event) {
        event.preventDefault();

        const id = $("edit-index").value.trim();
        const nome = $("cad-nome").value.trim();
        const cargo = $("cad-cargo").value.trim();
        const salarioTexto = $("cad-salario").value.trim();
        const status = document.querySelector('input[name="status"]:checked')?.value || "Ativo";
        const botao = event.submitter || document.querySelector(".btn-salvar-modal");

        if (!nome || !cargo) {
            alert("Preencha o nome e o cargo.");
            return;
        }

        const salario = salarioTexto ? salarioParaNumero(salarioTexto) : null;
        if (salarioTexto && (salario === null || salario < 0)) {
            alert("Informe um salário válido.");
            return;
        }

        const payload = { nome, cargo, salario, status };

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando...";
        }

        definirStatus("Salvando funcionário no banco de dados...");

        try {
            await garantirSessao();

            if (!id) {
                const { data, error } = await window.supabaseClient
                    .from("funcionarios")
                    .insert(payload)
                    .select("id,nome,cargo,salario,status,created_at,updated_at")
                    .single();

                if (error) throw error;

                if (window.registrarNoHistorico) {
                    await window.registrarNoHistorico("Cadastrou funcionário", data?.nome || nome, "👤");
                }
            } else {
                const anterior = listaFuncionarios.find(f => f.id === id);
                const { data, error } = await window.supabaseClient
                    .from("funcionarios")
                    .update(payload)
                    .eq("id", id)
                    .select("id,nome,cargo,salario,status,created_at,updated_at")
                    .single();

                if (error) throw error;

                if (window.registrarNoHistorico) {
                    await window.registrarNoHistorico(
                        "Editou funcionário",
                        `${anterior?.nome || nome} → ${data?.nome || nome}`,
                        "✏️"
                    );
                }
            }

            fecharModalCadastro();
            await carregarFuncionarios();
        } catch (erro) {
            console.error("Erro ao salvar funcionário:", erro);
            definirStatus(`Erro ao salvar: ${erro.message || erro}`, "erro");
            alert("Não foi possível salvar o funcionário.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "💾 Salvar";
            }
        }
    };

    window.abrirModalExcluir = function (id) {
        const f = listaFuncionarios.find(item => item.id === id);
        if (!f) return;

        funcionarioExclusaoId = id;
        $("excluir-index").value = id;
        $("texto-confirma-exclusao").innerHTML =
            `Excluir permanentemente "<strong>${escaparHtml(f.nome)}</strong>"? ` +
            `Os consumos e faltas vinculados a este funcionário no banco também serão afetados. ` +
            `Esta ação não pode ser desfeita.`;

        $("modal-excluir").style.display = "flex";
    };

    window.fecharModalExcluir = function () {
        funcionarioExclusaoId = null;
        $("modal-excluir").style.display = "none";
    };

    window.confirmarExclusao = async function () {
        const id = funcionarioExclusaoId || $("excluir-index").value;
        const removido = listaFuncionarios.find(f => f.id === id);
        if (!id || !removido) return;

        const botao = document.querySelector(".btn-excluir-modal");
        if (botao) {
            botao.disabled = true;
            botao.textContent = "Excluindo...";
        }

        definirStatus("Excluindo funcionário do banco de dados...");

        try {
            await garantirSessao();

            // Protege o histórico da empresa: funcionário com consumo/falta não é apagado.
            // Nesse caso, use o status Inativo.
            const [consumosResp, faltasResp] = await Promise.all([
                window.supabaseClient
                    .from("consumos")
                    .select("id", { count: "exact", head: true })
                    .eq("funcionario_id", id),
                window.supabaseClient
                    .from("faltas")
                    .select("id", { count: "exact", head: true })
                    .eq("funcionario_id", id)
            ]);

            if (consumosResp.error) throw consumosResp.error;
            if (faltasResp.error) throw faltasResp.error;

            const vinculos = (consumosResp.count || 0) + (faltasResp.count || 0);
            if (vinculos > 0) {
                alert(
                    `Este funcionário possui ${vinculos} registro(s) de consumo/falta.\n\n` +
                    "Para não perder o histórico da empresa, ele não pode ser excluído. Altere o status para Inativo."
                );
                definirStatus("Exclusão bloqueada para proteger o histórico", "ok");
                fecharModalExcluir();
                return;
            }

            const { error } = await window.supabaseClient
                .from("funcionarios")
                .delete()
                .eq("id", id);

            if (error) throw error;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico("Excluiu funcionário", removido.nome, "🗑️");
            }

            fecharModalExcluir();
            await carregarFuncionarios();
        } catch (erro) {
            console.error("Erro ao excluir funcionário:", erro);
            definirStatus(`Erro ao excluir: ${erro.message || erro}`, "erro");
            alert("Não foi possível excluir o funcionário.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = "Excluir";
            }
        }
    };

    window.alternarStatus = async function (id) {
        const f = listaFuncionarios.find(item => item.id === id);
        if (!f) return;

        const novoStatus = f.status === "Ativo" ? "Inativo" : "Ativo";
        definirStatus("Atualizando status no banco de dados...");

        try {
            await garantirSessao();

            const { error } = await window.supabaseClient
                .from("funcionarios")
                .update({ status: novoStatus })
                .eq("id", id);

            if (error) throw error;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Alterou status do funcionário",
                    `${f.nome}: ${f.status} → ${novoStatus}`,
                    "🔄"
                );
            }

            await carregarFuncionarios();
        } catch (erro) {
            console.error("Erro ao alterar status:", erro);
            definirStatus(`Erro ao alterar status: ${erro.message || erro}`, "erro");
            alert("Não foi possível alterar o status.\n\n" + (erro.message || erro));
        }
    };

    window.atualizarTabela = function () {
        const corpo = $("corpo-tabela");
        const rodape = $("contador-rodape");
        if (!corpo || !rodape) return;

        if (listaFuncionarios.length === 0) {
            corpo.innerHTML = `
                <tr id="linha-vazia">
                    <td colspan="5" class="tabela-vazia">
                        <span class="ponto-vermelho-vazio"></span>
                        Nenhum funcionário encontrado
                    </td>
                </tr>`;
            rodape.innerText = "Total: 0 funcionários";
            return;
        }

        corpo.innerHTML = listaFuncionarios.map(f => {
            const inicial = escaparHtml((f.nome || "?").charAt(0).toUpperCase());
            const corBadge = f.status === "Ativo" ? "badge-ativo" : "badge-inativo";
            const corBolinha = f.status === "Ativo" ? "#27ae60" : "#e74c3c";
            const idSeguro = JSON.stringify(f.id);

            return `
                <tr data-nome="${escaparHtml((f.nome || "").toLowerCase())}">
                    <td style="text-align:left;display:flex;align-items:center;gap:12px;padding-left:20px;">
                        <div class="avatar-letra">${inicial}</div>
                        <span style="font-weight:700;color:#333;">${escaparHtml(f.nome)}</span>
                    </td>
                    <td style="text-align:left;">${escaparHtml(f.cargo)}</td>
                    <td style="text-align:left;">${escaparHtml(salarioParaTela(f.salario))}</td>
                    <td style="text-align:left;"><span class="${corBadge}">${escaparHtml(f.status)}</span></td>
                    <td>
                        <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
                            <button type="button" aria-label="Editar" onclick='abrirModalEdicao(${idSeguro})' title="Editar"
                                style="border:none;background:none;cursor:pointer;font-size:16px;">✏️</button>
                            <button type="button" aria-label="Alternar status" onclick='alternarStatus(${idSeguro})' title="Alternar Status"
                                style="border:none;background:${corBolinha};width:12px;height:12px;border-radius:50%;cursor:pointer;transition:.2s;"></button>
                            <button type="button" aria-label="Excluir" onclick='abrirModalExcluir(${idSeguro})' title="Excluir"
                                style="border:none;background:none;cursor:pointer;font-size:16px;">🗑️</button>
                        </div>
                    </td>
                </tr>`;
        }).join("");

        rodape.innerText = `Total: ${listaFuncionarios.length} funcionário(s)`;
        filtrarFuncionarios();
    };

    window.filtrarFuncionarios = function () {
        const termo = ($("input-busca")?.value || "").trim().toLowerCase();
        document.querySelectorAll("#corpo-tabela tr[data-nome]").forEach(linha => {
            const texto = linha.textContent.toLowerCase();
            linha.style.display = texto.includes(termo) ? "" : "none";
        });
    };

    window.addEventListener("DOMContentLoaded", function () {
        // Faz uma cópia do localStorage antigo antes do primeiro carregamento
        // do Supabase sobrescrever o espelho de compatibilidade.
        criarBackupPreSupabaseSeNecessario();
        carregarFuncionarios();
    });

    // Expõe apenas para diagnóstico manual no console se necessário.
    window.recarregarFuncionariosDoBanco = carregarFuncionarios;
})();

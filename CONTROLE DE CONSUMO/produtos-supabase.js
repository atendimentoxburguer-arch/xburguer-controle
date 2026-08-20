(function () {
    "use strict";

    let listaProdutos = [];
    let produtoExclusaoId = null;

    const $ = (id) => document.getElementById(id);

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-produtos-banco");
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

    function precoParaNumero(valor) {
        if (valor === null || valor === undefined || valor === "" || valor === "—") return 0;
        const numero = window.formatarMoeda ? window.formatarMoeda(valor) : Number(valor);
        return Number.isFinite(numero) ? numero : 0;
    }

    function precoParaTela(valor) {
        const numero = Number(valor);
        if (!Number.isFinite(numero) || numero <= 0) return "—";
        if (window.moedaBR) return window.moedaBR(numero);
        return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    function precoParaCampo(valor) {
        const numero = Number(valor);
        if (!Number.isFinite(numero) || numero <= 0) return "";
        return numero.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
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
        if (localStorage.getItem("produtos_xburguer_backup_pre_supabase")) return;

        const bruto = localStorage.getItem("produtos_xburguer");
        if (!bruto) return;

        try {
            const dados = JSON.parse(bruto);
            if (Array.isArray(dados) && dados.length) {
                localStorage.setItem(
                    "produtos_xburguer_backup_pre_supabase",
                    JSON.stringify(dados)
                );
            }
        } catch (_) {}
    }

    function salvarEspelhoLocal() {
        // Compatibilidade temporária com a página Consumos enquanto ela ainda
        // não foi migrada. O Supabase é a fonte principal de Produtos.
        const espelho = listaProdutos.map(p => ({
            id: p.id,
            nome: p.nome,
            preco: precoParaTela(p.preco),
            status: p.ativo ? "Ativo" : "Inativo"
        }));
        localStorage.setItem("produtos_xburguer", JSON.stringify(espelho));
    }

    async function carregarProdutos() {
        definirStatus("Carregando produtos do banco de dados...");

        try {
            await garantirSessao();

            const { data, error } = await window.supabaseClient
                .from("produtos")
                .select("id,nome,preco,ativo,created_at,updated_at")
                .order("nome", { ascending: true });

            if (error) throw error;

            listaProdutos = Array.isArray(data) ? data : [];
            salvarEspelhoLocal();
            atualizarTabela();

            definirStatus(
                listaProdutos.length
                    ? `Banco de dados conectado • ${listaProdutos.length} produto(s) carregado(s)`
                    : "Banco de dados conectado • nenhum produto cadastrado ainda",
                "ok"
            );

            verificarDadosAntigos();
        } catch (erro) {
            console.error("Erro ao carregar produtos:", erro);
            definirStatus(`Erro ao carregar do banco: ${erro.message || erro}`, "erro");
            if (!window.XBURGUER_ATUALIZACAO_SILENCIOSA) {
                alert(
                    "Não foi possível carregar os produtos do banco de dados.\n\n" +
                    (erro.message || erro)
                );
            }
        }
    }

    function verificarDadosAntigos() {
        // Migração antiga encerrada: backups locais permanecem preservados, sem aviso na interface.
        return;
    }

    async function importarProdutosAntigos() {
        let antigos = [];
        try {
            antigos = JSON.parse(
                localStorage.getItem("produtos_xburguer_backup_pre_supabase") || "[]"
            );
        } catch (_) {}

        if (!antigos.length) {
            alert("Não há produtos antigos para importar.");
            return;
        }

        if (!confirm(
            `Importar ${antigos.length} produto(s) do backup local para o Supabase?\n\n` +
            "Produtos com o mesmo nome já existentes serão ignorados."
        )) {
            return;
        }

        definirStatus("Importando produtos antigos...");

        try {
            await garantirSessao();

            const existentes = new Set(
                listaProdutos.map(p => String(p.nome || "").trim().toLowerCase())
            );

            const novos = antigos
                .filter(p => p && p.nome)
                .filter(p => !existentes.has(String(p.nome).trim().toLowerCase()))
                .map(p => ({
                    nome: String(p.nome).trim(),
                    preco: precoParaNumero(p.preco),
                    ativo: p.status !== "Inativo" && p.ativo !== false
                }));

            if (novos.length) {
                const { error } = await window.supabaseClient
                    .from("produtos")
                    .insert(novos);

                if (error) throw error;
            }

            localStorage.setItem("produtos_migracao_supabase_resolvida", "1");

            alert(
                novos.length
                    ? `${novos.length} produto(s) importado(s) com sucesso.`
                    : "Nenhum produto novo precisou ser importado."
            );

            await carregarProdutos();
        } catch (erro) {
            console.error("Erro ao importar produtos antigos:", erro);
            definirStatus(`Erro na importação: ${erro.message || erro}`, "erro");
            alert(
                "Não foi possível importar os produtos antigos.\n\n" +
                (erro.message || erro)
            );
        }
    }

    window.abrirModalCadastro = function () {
        $("modal-titulo").innerText = "➕ Novo Produto";
        $("edit-index").value = "";
        $("cad-nome").value = "";
        $("cad-preco").value = "";
        document.querySelector('input[name="status"][value="Ativo"]').checked = true;
        $("modal-produto").style.display = "flex";
    };

    window.abrirModalEdicao = function (id) {
        const p = listaProdutos.find(item => item.id === id);
        if (!p) return;

        $("modal-titulo").innerText = "✏️ Editar Produto";
        $("edit-index").value = p.id;
        $("cad-nome").value = p.nome || "";
        $("cad-preco").value = precoParaCampo(p.preco);

        document.querySelector(
            `input[name="status"][value="${p.ativo ? "Ativo" : "Inativo"}"]`
        ).checked = true;

        $("modal-produto").style.display = "flex";
    };

    window.fecharModalCadastro = function () {
        $("modal-produto").style.display = "none";
    };

    window.salvarProduto = async function (event) {
        event.preventDefault();

        const id = $("edit-index").value.trim();
        const nome = $("cad-nome").value.trim();
        const precoTexto = $("cad-preco").value.trim();
        const status = document.querySelector('input[name="status"]:checked')?.value || "Ativo";
        const botao = event.submitter || document.querySelector(".btn-salvar-modal");

        if (!nome) {
            alert("Informe o nome do produto.");
            return;
        }

        const preco = precoTexto ? precoParaNumero(precoTexto) : 0;
        if (!Number.isFinite(preco) || preco < 0) {
            alert("Informe um preço válido.");
            return;
        }

        const payload = {
            nome,
            preco,
            ativo: status === "Ativo"
        };

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando...";
        }

        definirStatus("Salvando produto no banco de dados...");

        try {
            await garantirSessao();

            if (!id) {
                const { data, error } = await window.supabaseClient
                    .from("produtos")
                    .insert(payload)
                    .select("id,nome,preco,ativo,created_at,updated_at")
                    .single();

                if (error) throw error;

                if (window.registrarNoHistorico) {
                    await window.registrarNoHistorico(
                        "Cadastrou produto",
                        data?.nome || nome,
                        "🍔"
                    );
                }
            } else {
                const anterior = listaProdutos.find(p => p.id === id);

                const { data, error } = await window.supabaseClient
                    .from("produtos")
                    .update(payload)
                    .eq("id", id)
                    .select("id,nome,preco,ativo,created_at,updated_at")
                    .single();

                if (error) throw error;

                if (window.registrarNoHistorico) {
                    await window.registrarNoHistorico(
                        "Editou produto",
                        `${anterior?.nome || nome} → ${data?.nome || nome}`,
                        "✏️"
                    );
                }
            }

            fecharModalCadastro();
            await carregarProdutos();
        } catch (erro) {
            console.error("Erro ao salvar produto:", erro);
            definirStatus(`Erro ao salvar: ${erro.message || erro}`, "erro");
            alert(
                "Não foi possível salvar o produto.\n\n" +
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
        const p = listaProdutos.find(item => item.id === id);
        if (!p) return;

        produtoExclusaoId = id;
        $("excluir-index").value = id;
        $("texto-confirma-exclusao").innerHTML =
            `Excluir permanentemente "<strong>${escaparHtml(p.nome)}</strong>"? ` +
            "Se este produto estiver ligado a consumos já salvos no banco, o consumo continuará no histórico, mas deixará de ter vínculo direto com o produto. " +
            "Esta ação não pode ser desfeita.";

        $("modal-excluir").style.display = "flex";
    };

    window.fecharModalExcluir = function () {
        produtoExclusaoId = null;
        $("modal-excluir").style.display = "none";
    };

    window.confirmarExclusao = async function () {
        const id = produtoExclusaoId || $("excluir-index").value;
        const removido = listaProdutos.find(p => p.id === id);
        if (!id || !removido) return;

        const botao = document.querySelector(".btn-excluir-modal");
        if (botao) {
            botao.disabled = true;
            botao.textContent = "Excluindo...";
        }

        definirStatus("Excluindo produto do banco de dados...");

        try {
            await garantirSessao();

            const { error } = await window.supabaseClient
                .from("produtos")
                .delete()
                .eq("id", id);

            if (error) throw error;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Excluiu produto",
                    removido.nome,
                    "🗑️"
                );
            }

            fecharModalExcluir();
            await carregarProdutos();
        } catch (erro) {
            console.error("Erro ao excluir produto:", erro);
            definirStatus(`Erro ao excluir: ${erro.message || erro}`, "erro");
            alert(
                "Não foi possível excluir o produto.\n\n" +
                (erro.message || erro)
            );
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = "Excluir";
            }
        }
    };

    window.alternarStatus = async function (id) {
        const p = listaProdutos.find(item => item.id === id);
        if (!p) return;

        const novoAtivo = !p.ativo;
        definirStatus("Atualizando status no banco de dados...");

        try {
            await garantirSessao();

            const { error } = await window.supabaseClient
                .from("produtos")
                .update({ ativo: novoAtivo })
                .eq("id", id);

            if (error) throw error;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Alterou status do produto",
                    `${p.nome}: ${p.ativo ? "Ativo" : "Inativo"} → ${novoAtivo ? "Ativo" : "Inativo"}`,
                    "🔄"
                );
            }

            await carregarProdutos();
        } catch (erro) {
            console.error("Erro ao alterar status do produto:", erro);
            definirStatus(`Erro ao alterar status: ${erro.message || erro}`, "erro");
            alert(
                "Não foi possível alterar o status do produto.\n\n" +
                (erro.message || erro)
            );
        }
    };

    window.atualizarTabela = function () {
        const corpo = $("corpo-tabela");
        const rodape = $("contador-rodape");
        if (!corpo || !rodape) return;

        if (listaProdutos.length === 0) {
            corpo.innerHTML = `
                <tr id="linha-vazia">
                    <td colspan="4" class="tabela-vazia">
                        <span class="ponto-vermelho-vazio"></span>
                        Nenhum produto encontrado
                    </td>
                </tr>`;
            rodape.innerText = "Total: 0 produtos";
            return;
        }

        corpo.innerHTML = listaProdutos.map(p => {
            const status = p.ativo ? "Ativo" : "Inativo";
            const corBadge = p.ativo ? "badge-ativo" : "badge-inativo";
            const corBolinha = p.ativo ? "#27ae60" : "#e74c3c";
            const idSeguro = JSON.stringify(p.id);

            return `
                <tr data-busca="${escaparHtml(`${p.nome} ${status}`.toLowerCase())}">
                    <td style="text-align:left;display:flex;align-items:center;gap:12px;padding-left:20px;">
                        <span style="font-size:18px;">🍔</span>
                        <span style="font-weight:700;color:#333;">${escaparHtml(p.nome)}</span>
                    </td>
                    <td style="text-align:left;">${escaparHtml(precoParaTela(p.preco))}</td>
                    <td style="text-align:left;"><span class="${corBadge}">${status}</span></td>
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

        rodape.innerText = `Total: ${listaProdutos.length} produto(s)`;
        filtrarProdutos();
    };

    window.filtrarProdutos = function () {
        const termo = ($("input-busca")?.value || "").trim().toLowerCase();
        document.querySelectorAll("#corpo-tabela tr[data-busca]").forEach(linha => {
            linha.style.display = linha.textContent.toLowerCase().includes(termo)
                ? ""
                : "none";
        });
    };

    window.addEventListener("DOMContentLoaded", function () {
        // Faz backup do armazenamento antigo ANTES de o espelho do Supabase
        // substituir produtos_xburguer.
        criarBackupPreSupabaseSeNecessario();
        carregarProdutos();
    });

    window.recarregarProdutosDoBanco = carregarProdutos;
})();

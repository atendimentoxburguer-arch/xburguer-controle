(function () {
    "use strict";

    let consumoEdicaoId = null;
    let consumoOriginal = null;
    let carregandoEdicao = false;

    const $ = id => document.getElementById(id);
    const abrirCadastroOriginal = window.abrirModalCadastro;
    const fecharCadastroOriginal = window.fecharModalCadastro;
    const salvarConsumoOriginal = window.salvarConsumo;
    const alternarTipoOriginal = window.alternarTipoConsumo;

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function valorCampo(valor) {
        const n = Number(valor) || 0;
        return n.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function numeroMoeda(valor) {
        let s = String(valor ?? "").replace(/R\$/gi, "").trim().replace(/\s/g, "");
        if (!s) return 0;
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        const n = Number(s);
        return Number.isFinite(n) ? n : NaN;
    }

    function moedaTela(valor) {
        return (Number(valor) || 0).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }

    function dataHoraParaInput(valor) {
        const d = valor ? new Date(valor) : new Date();
        if (Number.isNaN(d.getTime())) return "";
        const p = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function garantirCampoDataHora() {
        let grupo = $("grupo-datahora-edicao");
        if (grupo) return grupo;

        const obs = $("cad-obs")?.closest(".grupo-input-modal");
        if (!obs) return null;

        grupo = document.createElement("div");
        grupo.id = "grupo-datahora-edicao";
        grupo.className = "grupo-input-modal";
        grupo.style.display = "none";
        grupo.innerHTML = `
            <label for="cad-data-hora-edicao">Data e hora *</label>
            <input type="datetime-local" id="cad-data-hora-edicao" style="width:100%;">
            <small style="display:block;margin-top:5px;color:#777;">Use este campo para corrigir a data ou o horário do lançamento.</small>`;
        obs.parentNode.insertBefore(grupo, obs);
        return grupo;
    }

    function atualizarCabecalhoModal(edicao) {
        const modal = $("modal-consumo");
        if (!modal) return;
        const titulo = modal.querySelector(".modal-topo h3");
        const subtitulo = modal.querySelector(".modal-topo p");
        const botao = modal.querySelector(".btn-salvar-modal");
        const grupoData = garantirCampoDataHora();

        if (titulo) titulo.textContent = edicao ? "✏️ Editar Consumo" : "➕ Novo Consumo";
        if (subtitulo) subtitulo.textContent = edicao
            ? "Corrija as informações necessárias. A alteração ficará registrada na auditoria."
            : "Registre o consumo de um funcionário";
        if (botao) botao.textContent = edicao ? "💾 Salvar alterações" : "💾 Salvar";
        if (grupoData) grupoData.style.display = edicao ? "block" : "none";
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

    function preencherSelectFuncionarios(lista, selecionado) {
        const select = $("cad-funcionario");
        if (!select) return;
        select.innerHTML = '<option value="">Selecione...</option>';
        (lista || []).forEach(f => {
            const opt = document.createElement("option");
            opt.value = f.id;
            opt.textContent = `${f.nome}${f.status === "Ativo" ? "" : " (inativo)"}`;
            select.appendChild(opt);
        });
        select.value = selecionado || "";
    }

    function preencherSelectProdutos(lista, selecionado) {
        const select = $("cad-produto");
        if (!select) return;
        select.innerHTML = '<option value="">Selecione...</option>';
        (lista || []).forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.nome} (${moedaTela(p.preco)})${p.ativo ? "" : " • inativo"}`;
            opt.dataset.preco = String(p.preco ?? 0);
            select.appendChild(opt);
        });
        select.value = selecionado || "";
        select.onchange = window.atualizarPrecoDoProduto;
    }

    function extrairIdDoBotaoExcluir(botao) {
        const texto = botao?.getAttribute("onclick") || "";
        const m = texto.match(/abrirModalExcluir\((.+)\)/);
        if (!m) return null;
        try {
            return JSON.parse(m[1]);
        } catch (_) {
            return String(m[1]).replace(/^['"]|['"]$/g, "");
        }
    }

    function adicionarBotoesEditar() {
        const corpo = $("corpo-tabela");
        if (!corpo) return;

        corpo.querySelectorAll('button[onclick*="abrirModalExcluir"]').forEach(botaoExcluir => {
            const area = botaoExcluir.parentElement;
            if (!area || area.querySelector(".btn-editar-consumo")) return;
            const id = extrairIdDoBotaoExcluir(botaoExcluir);
            if (!id) return;

            const botao = document.createElement("button");
            botao.type = "button";
            botao.className = "btn-editar-consumo";
            botao.setAttribute("aria-label", "Editar consumo");
            botao.title = "Editar";
            botao.textContent = "✏️";
            botao.style.cssText = "border:none;background:none;cursor:pointer;font-size:16px;";
            botao.addEventListener("click", () => window.abrirModalEdicaoConsumo(id));
            area.insertBefore(botao, botaoExcluir);
        });
    }

    window.alternarTipoConsumo = function () {
        if (typeof alternarTipoOriginal === "function") alternarTipoOriginal();
        if (!consumoEdicaoId) return;

        const preco = $("cad-preco-avulso");
        const ajuda = $("ajuda-preco-consumo");
        if (preco) preco.readOnly = false;
        if (ajuda) ajuda.textContent = "Na edição, o preço unitário também pode ser corrigido manualmente.";
    };

    window.abrirModalCadastro = function () {
        consumoEdicaoId = null;
        consumoOriginal = null;
        if (typeof abrirCadastroOriginal === "function") abrirCadastroOriginal();
        atualizarCabecalhoModal(false);
    };

    window.fecharModalCadastro = function () {
        consumoEdicaoId = null;
        consumoOriginal = null;
        if (typeof fecharCadastroOriginal === "function") fecharCadastroOriginal();
        atualizarCabecalhoModal(false);
    };

    window.abrirModalEdicaoConsumo = async function (id) {
        if (!id || carregandoEdicao) return;
        carregandoEdicao = true;

        try {
            await garantirSessao();
            const [respConsumo, respFuncionarios, respProdutos] = await Promise.all([
                window.supabaseClient
                    .from("consumos")
                    .select("id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,valor_total,data_hora,created_at")
                    .eq("id", id)
                    .single(),
                window.supabaseClient
                    .from("funcionarios")
                    .select("id,nome,status")
                    .order("nome", { ascending: true }),
                window.supabaseClient
                    .from("produtos")
                    .select("id,nome,preco,ativo")
                    .order("nome", { ascending: true })
            ]);

            if (respConsumo.error) throw respConsumo.error;
            if (respFuncionarios.error) throw respFuncionarios.error;
            if (respProdutos.error) throw respProdutos.error;

            consumoEdicaoId = id;
            consumoOriginal = respConsumo.data;

            preencherSelectFuncionarios(respFuncionarios.data, consumoOriginal.funcionario_id);
            preencherSelectProdutos(respProdutos.data, consumoOriginal.produto_id);

            const radio = document.querySelector(`input[name="tipo-consumo"][value="${consumoOriginal.tipo === "avulso" ? "avulso" : "produto"}"]`);
            if (radio) radio.checked = true;

            if (typeof alternarTipoOriginal === "function") alternarTipoOriginal();

            $("cad-funcionario").value = consumoOriginal.funcionario_id || "";
            $("cad-produto").value = consumoOriginal.produto_id || "";
            $("cad-descricao-avulsa").value = consumoOriginal.tipo === "avulso" ? (consumoOriginal.descricao || "") : "";
            $("cad-qtd").value = String(Math.max(1, Number(consumoOriginal.quantidade) || 1));
            $("cad-preco-avulso").value = valorCampo(consumoOriginal.preco_unitario);
            $("cad-preco-avulso").readOnly = false;
            $("cad-obs").value = consumoOriginal.observacao || "";

            const campoData = garantirCampoDataHora();
            if (campoData) campoData.style.display = "block";
            $("cad-data-hora-edicao").value = dataHoraParaInput(consumoOriginal.data_hora || consumoOriginal.created_at);

            const ajuda = $("ajuda-preco-consumo");
            if (ajuda) ajuda.textContent = "Na edição, o preço unitário também pode ser corrigido manualmente.";

            atualizarCabecalhoModal(true);

            const modal = $("modal-consumo");
            modal.style.display = "flex";
            const caixa = modal.querySelector(".modal-caixa");
            if (caixa) caixa.scrollTop = 0;
            modal.scrollTop = 0;

            if (typeof window.sincronizarAlturaVisivel === "function") {
                window.sincronizarAlturaVisivel();
            }
        } catch (erro) {
            console.error("Erro ao abrir edição do consumo:", erro);
            alert("Não foi possível abrir este consumo para edição.\n\n" + (erro.message || erro));
            consumoEdicaoId = null;
            consumoOriginal = null;
        } finally {
            carregandoEdicao = false;
        }
    };

    async function registrarEdicaoNoHistorico(antes, depois, nomeFuncionario) {
        if (typeof window.registrarNoHistorico !== "function") return;
        const antesQtd = Number(antes?.quantidade) || 1;
        const depoisQtd = Number(depois?.quantidade) || 1;
        const antesTotal = Number(antes?.valor_total ?? (Number(antes?.preco_unitario || 0) * antesQtd)) || 0;
        const depoisTotal = Number(depois?.valor_total ?? (Number(depois?.preco_unitario || 0) * depoisQtd)) || 0;

        await window.registrarNoHistorico(
            "Editou consumo",
            `${nomeFuncionario} - ${depois.descricao} • ${antesQtd} un. / ${moedaTela(antesTotal)} → ${depoisQtd} un. / ${moedaTela(depoisTotal)}`,
            "✏️"
        );
    }

    window.salvarConsumo = async function (event) {
        if (!consumoEdicaoId) {
            return salvarConsumoOriginal(event);
        }

        event.preventDefault();
        const idEmEdicao = consumoEdicaoId;
        const antes = consumoOriginal;
        const tipo = document.querySelector('input[name="tipo-consumo"]:checked')?.value || "produto";
        const funcionarioId = $("cad-funcionario").value;
        const produtoId = tipo === "produto" ? ($("cad-produto").value || null) : null;
        const descricaoAvulsa = $("cad-descricao-avulsa").value.trim();
        const quantidade = Math.max(1, parseInt($("cad-qtd").value, 10) || 1);
        const precoUnitario = numeroMoeda($("cad-preco-avulso").value);
        const observacao = $("cad-obs").value.trim();
        const dataHoraLocal = $("cad-data-hora-edicao").value;
        const dataHora = new Date(dataHoraLocal);
        const botao = event.submitter || document.querySelector(".btn-salvar-modal");

        if (!funcionarioId) {
            alert("Selecione o funcionário.");
            return;
        }
        if (tipo === "avulso" && !descricaoAvulsa) {
            alert("Informe o que foi consumido.");
            return;
        }
        if (tipo === "produto" && !produtoId && !(antes?.tipo === "produto" && !antes?.produto_id && antes?.descricao)) {
            alert("Selecione o produto.");
            return;
        }
        if (!Number.isFinite(precoUnitario) || precoUnitario < 0) {
            alert("Informe um preço unitário válido.");
            return;
        }
        if (!dataHoraLocal || Number.isNaN(dataHora.getTime())) {
            alert("Informe uma data e hora válidas.");
            return;
        }

        let descricao = descricaoAvulsa;
        if (tipo === "produto") {
            const opt = $("cad-produto")?.options?.[$("cad-produto").selectedIndex];
            descricao = produtoId
                ? String(opt?.textContent || "Produto").replace(/\s*\([^)]*\)(?:\s*•\s*inativo)?\s*$/, "").trim()
                : (antes?.descricao || "Produto");
        }

        const payload = {
            funcionario_id: funcionarioId,
            produto_id: produtoId,
            tipo,
            descricao,
            observacao: observacao || null,
            quantidade,
            preco_unitario: precoUnitario,
            data_hora: dataHora.toISOString()
        };

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando alterações...";
        }

        try {
            await garantirSessao();
            const { data, error } = await window.supabaseClient
                .from("consumos")
                .update(payload)
                .eq("id", idEmEdicao)
                .select("id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,valor_total,data_hora,created_at")
                .single();

            if (error) throw error;

            const funcionarioSelecionado = $("cad-funcionario")?.options?.[$("cad-funcionario").selectedIndex]?.textContent || "Funcionário";
            await registrarEdicaoNoHistorico(antes, data, funcionarioSelecionado.replace(/\s+\(inativo\)$/, ""));

            window.fecharModalCadastro();
            if (typeof window.recarregarConsumosDoBanco === "function") {
                await window.recarregarConsumosDoBanco();
            }
        } catch (erro) {
            console.error("Erro ao editar consumo:", erro);
            alert("Não foi possível salvar as alterações.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "💾 Salvar alterações";
            }
        }
    };

    function iniciarObservadorTabela() {
        const corpo = $("corpo-tabela");
        if (!corpo) return;
        const observer = new MutationObserver(() => adicionarBotoesEditar());
        observer.observe(corpo, { childList: true, subtree: true });
        adicionarBotoesEditar();
    }

    window.addEventListener("DOMContentLoaded", function () {
        garantirCampoDataHora();
        atualizarCabecalhoModal(false);
        iniciarObservadorTabela();
    });
})();

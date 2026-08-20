(function () {
    "use strict";

    let listaConsumos = [];
    let listaFuncionarios = [];
    let listaProdutos = [];
    let consumoExclusaoId = null;

    const $ = (id) => document.getElementById(id);

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-consumos-banco");
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

    function numeroMoeda(valor) {
        if (valor === null || valor === undefined || valor === "" || valor === "—") return 0;
        if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
        if (window.formatarMoeda) return window.formatarMoeda(valor);

        let s = String(valor).replace(/R\$/gi, "").trim().replace(/\s/g, "");
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
    }

    function moedaTela(valor) {
        const n = Number(valor) || 0;
        if (window.moedaBR) return window.moedaBR(n);
        return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    function valorCampo(valor) {
        const n = Number(valor) || 0;
        return n.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatarDataHoraTela(valor) {
        if (!valor) return "—";
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return String(valor);
        return d.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function dataTela(valor) {
        if (!valor) return "";
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleDateString("pt-BR");
    }

    function horaTela(valor) {
        if (!valor) return "";
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }

    function obterFuncionarioPorId(id) {
        return listaFuncionarios.find(f => f.id === id) || null;
    }

    function obterProdutoPorId(id) {
        return listaProdutos.find(p => p.id === id) || null;
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

    function criarBackupPreSupabaseSeNecessario() {
        if (localStorage.getItem("consumos_xburguer_backup_pre_supabase")) return;
        const bruto = localStorage.getItem("consumos_xburguer");
        if (!bruto) return;

        try {
            const dados = JSON.parse(bruto);
            if (Array.isArray(dados) && dados.length) {
                localStorage.setItem(
                    "consumos_xburguer_backup_pre_supabase",
                    JSON.stringify(dados)
                );
            }
        } catch (_) {}
    }

    function salvarEspelhoLocal() {
        // Compatibilidade temporária com Dashboard e Relatórios. O Supabase é
        // a fonte principal de Consumos a partir desta etapa.
        const espelho = listaConsumos.map(c => {
            const f = obterFuncionarioPorId(c.funcionario_id);
            const p = obterProdutoPorId(c.produto_id);
            const funcionario = f?.nome || c.funcionario_nome || "Funcionário removido";
            const nomeItem = c.tipo === "avulso"
                ? c.descricao
                : (p?.nome || c.descricao || "Produto removido");
            const qtd = Number(c.quantidade) || 1;
            const unit = Number(c.preco_unitario) || 0;
            const total = Number(c.valor_total ?? (unit * qtd)) || 0;

            return {
                id: c.id,
                funcionarioId: c.funcionario_id,
                funcionario,
                tipo: c.tipo,
                produto: nomeItem,
                produtoCadastrado: c.tipo === "produto" ? nomeItem : "",
                descricao: c.tipo === "avulso" ? c.descricao : "",
                qtd,
                quantidade: qtd,
                precoUnitario: moedaTela(unit),
                precoUnitarioNumerico: unit,
                valorUnitario: unit,
                valor: moedaTela(total),
                valorNumerico: total,
                dataHora: formatarDataHoraTela(c.data_hora),
                data: dataTela(c.data_hora),
                hora: horaTela(c.data_hora),
                obs: c.observacao || ""
            };
        });
        localStorage.setItem("consumos_xburguer", JSON.stringify(espelho));
    }

    async function carregarConsumosPaginados() {
        const tamanhoPagina = 1000;
        let inicio = 0;
        const todos = [];

        while (true) {
            const { data, error } = await window.supabaseClient
                .from("consumos")
                .select("id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,valor_total,data_hora,created_at")
                .order("data_hora", { ascending: false })
                .range(inicio, inicio + tamanhoPagina - 1);

            if (error) throw error;
            const lote = Array.isArray(data) ? data : [];
            todos.push(...lote);
            if (lote.length < tamanhoPagina) break;
            inicio += tamanhoPagina;
        }

        return todos;
    }

    async function carregarDadosBase() {
        const [respFuncionarios, respProdutos, consumos] = await Promise.all([
            window.supabaseClient
                .from("funcionarios")
                .select("id,nome,cargo,salario,status")
                .order("nome", { ascending: true }),
            window.supabaseClient
                .from("produtos")
                .select("id,nome,preco,ativo")
                .order("nome", { ascending: true }),
            carregarConsumosPaginados()
        ]);

        if (respFuncionarios.error) throw respFuncionarios.error;
        if (respProdutos.error) throw respProdutos.error;

        listaFuncionarios = Array.isArray(respFuncionarios.data) ? respFuncionarios.data : [];
        listaProdutos = Array.isArray(respProdutos.data) ? respProdutos.data : [];
        listaConsumos = consumos;
    }

    async function carregarTudo() {
        definirStatus("Carregando consumos do banco de dados...");
        try {
            await garantirSessao();
            await carregarDadosBase();
            carregarSelects();
            salvarEspelhoLocal();
            atualizarTabela();
            definirStatus(
                listaConsumos.length
                    ? `Banco de dados conectado • ${listaConsumos.length} consumo(s) carregado(s)`
                    : "Banco de dados conectado • nenhum consumo registrado ainda",
                "ok"
            );
            verificarDadosAntigos();
        } catch (erro) {
            console.error("Erro ao carregar Consumos:", erro);
            definirStatus(`Erro ao carregar do banco: ${erro.message || erro}`, "erro");
            if (!window.XBURGUER_ATUALIZACAO_SILENCIOSA) alert("Não foi possível carregar os consumos do banco de dados.\n\n" + (erro.message || erro));
        }
    }

    window.carregarSelects = function () {
        const selectFuncModal = $("cad-funcionario");
        const selectFuncFiltro = $("filtro-funcionario");
        const selectProdModal = $("cad-produto");
        if (!selectFuncModal || !selectFuncFiltro || !selectProdModal) return;

        const filtroAtual = selectFuncFiltro.value || "todos";
        selectFuncModal.innerHTML = '<option value="">Selecione...</option>';
        selectFuncFiltro.innerHTML = '<option value="todos">Todos os funcionários</option>';
        selectProdModal.innerHTML = '<option value="">Selecione...</option>';

        listaFuncionarios.forEach(f => {
            const optFiltro = document.createElement("option");
            optFiltro.value = f.id;
            optFiltro.textContent = f.nome;
            selectFuncFiltro.appendChild(optFiltro);

            if (f.status === "Ativo") {
                const optModal = document.createElement("option");
                optModal.value = f.id;
                optModal.textContent = f.nome;
                selectFuncModal.appendChild(optModal);
            }
        });

        listaProdutos.filter(p => p.ativo).forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.nome} (${moedaTela(p.preco)})`;
            opt.dataset.preco = String(p.preco ?? 0);
            selectProdModal.appendChild(opt);
        });

        if ([...selectFuncFiltro.options].some(o => o.value === filtroAtual)) {
            selectFuncFiltro.value = filtroAtual;
        }
        selectProdModal.onchange = atualizarPrecoDoProduto;
    };

    window.alterarQtd = function (valor) {
        const inputQtd = $("cad-qtd");
        const atual = Math.max(1, (parseInt(inputQtd.value, 10) || 1) + valor);
        inputQtd.value = atual;
    };

    window.formatarPrecoConsumo = function (input) {
        let v = String(input.value || "").replace(/\D/g, "");
        if (!v) {
            input.value = "";
            return;
        }
        const n = Number(v) / 100;
        input.value = valorCampo(n);
    };

    function obterTipoConsumo() {
        return document.querySelector('input[name="tipo-consumo"]:checked')?.value || "produto";
    }

    window.alternarTipoConsumo = function () {
        const tipo = obterTipoConsumo();
        const grupoProduto = $("grupo-produto-cadastrado");
        const grupoAvulso = $("grupo-descricao-avulsa");
        const produto = $("cad-produto");
        const descricao = $("cad-descricao-avulsa");
        const preco = $("cad-preco-avulso");
        const ajuda = $("ajuda-preco-consumo");

        if (tipo === "avulso") {
            grupoProduto.style.display = "none";
            grupoAvulso.style.display = "block";
            produto.required = false;
            descricao.required = true;
            preco.readOnly = false;
            preco.value = "";
            preco.placeholder = "0,00";
            ajuda.textContent = "Informe o preço unitário deste consumo avulso.";
        } else {
            grupoProduto.style.display = "block";
            grupoAvulso.style.display = "none";
            produto.required = true;
            descricao.required = false;
            preco.readOnly = true;
            preco.placeholder = "Automático";
            atualizarPrecoDoProduto();
        }
    };

    window.atualizarPrecoDoProduto = function () {
        if (obterTipoConsumo() !== "produto") return;
        const select = $("cad-produto");
        const input = $("cad-preco-avulso");
        const option = select?.options?.[select.selectedIndex];
        const preco = option?.dataset?.preco;
        input.value = preco === undefined || preco === "" ? "0,00" : valorCampo(Number(preco) || 0);
    };

    window.abrirModalCadastro = function () {
        carregarSelects();
        $("cad-funcionario").value = "";
        $("cad-produto").value = "";
        $("cad-descricao-avulsa").value = "";
        $("cad-qtd").value = "1";
        $("cad-preco-avulso").value = "";
        $("cad-obs").value = "";
        document.querySelector('input[name="tipo-consumo"][value="produto"]').checked = true;
        alternarTipoConsumo();

        const modal = $("modal-consumo");
        modal.style.display = "flex";

        const caixa = modal.querySelector(".modal-caixa");
        if (caixa) {
            caixa.scrollTop = 0;
        }
        modal.scrollTop = 0;

        if (typeof window.sincronizarAlturaVisivel === "function") {
            window.sincronizarAlturaVisivel();
        }
    };

    window.fecharModalCadastro = function () {
        $("modal-consumo").style.display = "none";
    };

    async function registrarHistoricoLocal(acao, detalhes, icone) {
        // Temporário: Histórico será migrado para Supabase em etapa própria.
        if (window.registrarNoHistorico) {
            return await window.registrarNoHistorico(acao, detalhes, icone);
        }
        let historico = [];
        try { historico = JSON.parse(localStorage.getItem("historico_xburguer")) || []; } catch (_) {}
        const agora = new Date();
        historico.push({
            data: agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
            hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            usuario: "X-Burguer",
            acao,
            icone,
            detalhes
        });
        localStorage.setItem("historico_xburguer", JSON.stringify(historico));
    }

    window.salvarConsumo = async function (event) {
        event.preventDefault();

        const funcionarioId = $("cad-funcionario").value;
        const tipo = obterTipoConsumo();
        const produtoId = tipo === "produto" ? $("cad-produto").value : null;
        const descricaoAvulsa = $("cad-descricao-avulsa").value.trim();
        const quantidade = Math.max(1, parseInt($("cad-qtd").value, 10) || 1);
        const observacao = $("cad-obs").value.trim();
        const precoUnitario = numeroMoeda($("cad-preco-avulso").value);
        const botao = event.submitter || document.querySelector(".btn-salvar-modal");

        const funcionario = obterFuncionarioPorId(funcionarioId);
        const produto = produtoId ? obterProdutoPorId(produtoId) : null;

        if (!funcionarioId || !funcionario) {
            alert("Selecione um funcionário ativo.");
            return;
        }
        if (tipo === "produto" && (!produtoId || !produto)) {
            alert("Selecione um produto ativo.");
            return;
        }
        if (tipo === "avulso" && !descricaoAvulsa) {
            alert("Informe o que foi consumido.");
            return;
        }
        if (!Number.isFinite(precoUnitario) || precoUnitario < 0) {
            alert("Informe um preço válido.");
            return;
        }

        const descricao = tipo === "avulso" ? descricaoAvulsa : produto.nome;
        const payload = {
            funcionario_id: funcionarioId,
            produto_id: tipo === "produto" ? produtoId : null,
            tipo,
            descricao,
            observacao: observacao || null,
            quantidade,
            preco_unitario: precoUnitario,
            data_hora: new Date().toISOString()
        };

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando...";
        }
        definirStatus("Salvando consumo no banco de dados...");

        try {
            await garantirSessao();
            const { data, error } = await window.supabaseClient
                .from("consumos")
                .insert(payload)
                .select("id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,valor_total,data_hora,created_at")
                .single();

            if (error) throw error;

            const valorTotal = Number(data?.valor_total ?? (precoUnitario * quantidade)) || 0;
            await registrarHistoricoLocal(
                "Registrou consumo",
                `${funcionario.nome} - ${descricao} (${quantidade}x) - ${moedaTela(valorTotal)}`,
                tipo === "avulso" ? "📝" : "🍔"
            );

            fecharModalCadastro();
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao salvar consumo:", erro);
            definirStatus(`Erro ao salvar: ${erro.message || erro}`, "erro");
            alert("Não foi possível salvar o consumo.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "💾 Salvar";
            }
        }
    };

    window.abrirModalExcluir = function (id) {
        const c = listaConsumos.find(item => item.id === id);
        if (!c) return;
        const f = obterFuncionarioPorId(c.funcionario_id);
        consumoExclusaoId = id;
        $("excluir-index").value = id;
        $("texto-confirma-exclusao").innerHTML =
            `Excluir o consumo de <strong>${escaparHtml(f?.nome || "funcionário")}</strong> ` +
            `(${escaparHtml(c.descricao)})? Esta ação não pode ser desfeita.`;
        $("modal-excluir").style.display = "flex";
    };

    window.fecharModalExcluir = function () {
        consumoExclusaoId = null;
        $("modal-excluir").style.display = "none";
    };

    window.confirmarExclusao = async function () {
        const id = consumoExclusaoId || $("excluir-index").value;
        const removido = listaConsumos.find(c => c.id === id);
        if (!id || !removido) return;

        const f = obterFuncionarioPorId(removido.funcionario_id);
        const botao = document.querySelector(".btn-excluir-modal");
        if (botao) {
            botao.disabled = true;
            botao.textContent = "Excluindo...";
        }
        definirStatus("Excluindo consumo do banco de dados...");

        try {
            await garantirSessao();
            const { error } = await window.supabaseClient
                .from("consumos")
                .delete()
                .eq("id", id);
            if (error) throw error;

            await registrarHistoricoLocal(
                "Excluiu consumo",
                `${f?.nome || "Funcionário"} - ${removido.descricao}`,
                "🗑️"
            );
            fecharModalExcluir();
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao excluir consumo:", erro);
            definirStatus(`Erro ao excluir: ${erro.message || erro}`, "erro");
            alert("Não foi possível excluir o consumo.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = "Excluir";
            }
        }
    };

    window.atualizarTabela = function () {
        const corpo = $("corpo-tabela");
        const rodape = $("contador-rodape");
        const contadorTopo = $("contador-topo-filtros");
        const filtro = $("filtro-funcionario")?.value || "todos";
        if (!corpo || !rodape || !contadorTopo) return;

        const filtrados = listaConsumos.filter(c => filtro === "todos" || c.funcionario_id === filtro);

        if (!filtrados.length) {
            corpo.innerHTML = `
                <tr id="linha-vazia">
                    <td colspan="6" class="tabela-vazia">
                        <span class="ponto-vermelho-vazio"></span>
                        Nenhum consumo registrado
                    </td>
                </tr>`;
            rodape.textContent = "Total: 0 registros";
            contadorTopo.textContent = "Total: 0 registros";
            return;
        }

        corpo.innerHTML = filtrados.map(c => {
            const f = obterFuncionarioPorId(c.funcionario_id);
            const p = obterProdutoPorId(c.produto_id);
            const funcionario = f?.nome || "Funcionário removido";
            const produtoDescricao = c.tipo === "avulso" ? c.descricao : (p?.nome || c.descricao);
            const total = Number(c.valor_total ?? (Number(c.preco_unitario) * Number(c.quantidade))) || 0;
            const inicial = funcionario.charAt(0).toUpperCase();
            const idSeguro = JSON.stringify(c.id);

            return `
                <tr>
                    <td style="text-align:left;display:flex;align-items:center;gap:10px;padding-left:20px;">
                        <div class="avatar-letra" style="width:30px;height:30px;font-size:13px;">${escaparHtml(inicial)}</div>
                        <span style="font-weight:700;color:#333;">${escaparHtml(funcionario)}</span>
                    </td>
                    <td style="text-align:left;">
                        ${c.tipo === "avulso" ? "📝" : "🍔"} ${escaparHtml(produtoDescricao)}
                        ${c.observacao ? `<div style="font-size:11px;color:#888;margin-top:3px;">Obs.: ${escaparHtml(c.observacao)}</div>` : ""}
                    </td>
                    <td style="text-align:left;">${Number(c.quantidade) || 1}x</td>
                    <td style="text-align:left;font-weight:bold;color:#7a0b0b;">${escaparHtml(moedaTela(total))}</td>
                    <td style="text-align:left;color:#666;font-size:13px;">${escaparHtml(formatarDataHoraTela(c.data_hora))}</td>
                    <td>
                        <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
                            <button type="button" aria-label="Excluir" onclick='abrirModalExcluir(${idSeguro})' title="Excluir"
                                style="border:none;background:none;cursor:pointer;font-size:16px;">🗑️</button>
                        </div>
                    </td>
                </tr>`;
        }).join("");

        rodape.textContent = `Total: ${filtrados.length} registro(s)`;
        contadorTopo.textContent = `Total: ${filtrados.length} registros`;
    };

    function parseDataHoraAntiga(item) {
        const raw = item?.dataHora || item?.data_hora || item?.criadoEm || item?.created_at;
        if (raw) {
            const texto = String(raw).trim();
            const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
            if (br) {
                const d = new Date(
                    Number(br[3]), Number(br[2]) - 1, Number(br[1]),
                    Number(br[4] || 12), Number(br[5] || 0), 0, 0
                );
                return d.toISOString();
            }
            const d = new Date(texto);
            if (!Number.isNaN(d.getTime())) return d.toISOString();
        }

        if (item?.data) {
            const texto = String(item.data).trim();
            const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
            if (br) {
                const hora = String(item.hora || "12:00").match(/(\d{2}):(\d{2})/);
                const d = new Date(
                    Number(br[3]), Number(br[2]) - 1, Number(br[1]),
                    Number(hora?.[1] || 12), Number(hora?.[2] || 0), 0, 0
                );
                return d.toISOString();
            }
        }
        return new Date().toISOString();
    }

    function normalizarNome(valor) {
        return String(valor || "").trim().toLocaleLowerCase("pt-BR");
    }

    function verificarDadosAntigos() {
        // Migração antiga encerrada: backups locais permanecem preservados, sem aviso na interface.
        return;
    }

    async function importarConsumosAntigos() {
        let antigos = [];
        try {
            antigos = JSON.parse(localStorage.getItem("consumos_xburguer_backup_pre_supabase") || "[]");
        } catch (_) {}

        if (!antigos.length) {
            alert("Não há consumos antigos para importar.");
            return;
        }
        if (!confirm(
            `Importar ${antigos.length} consumo(s) do backup local para o Supabase?\n\n` +
            "O sistema tentará relacionar cada registro aos funcionários e produtos já cadastrados."
        )) return;

        definirStatus("Preparando importação dos consumos antigos...");
        try {
            await garantirSessao();
            await carregarDadosBase();

            const funcionariosPorNome = new Map(
                listaFuncionarios.map(f => [normalizarNome(f.nome), f])
            );
            const produtosPorNome = new Map(
                listaProdutos.map(p => [normalizarNome(p.nome), p])
            );

            let ignoradosSemFuncionario = 0;
            const novos = [];

            for (const item of antigos) {
                const nomeFuncionario = item.funcionario || item.nomeFuncionario || item.nome || "";
                const funcionario = funcionariosPorNome.get(normalizarNome(nomeFuncionario));
                if (!funcionario) {
                    ignoradosSemFuncionario++;
                    continue;
                }

                const tipo = item.tipo === "avulso" ? "avulso" : "produto";
                const nomeItem = item.descricao || item.produto || item.item || item.nomeProduto || "Consumo antigo";
                const produtoNome = item.produtoCadastrado || item.produto || item.nomeProduto || "";
                const produto = tipo === "produto"
                    ? produtosPorNome.get(normalizarNome(produtoNome)) || null
                    : null;
                const quantidade = Math.max(1, parseInt(item.quantidade ?? item.qtd ?? item.qtde, 10) || 1);

                let precoUnitario = numeroMoeda(
                    item.precoUnitarioNumerico ?? item.valorUnitario ?? item.precoUnitario ?? item.preco
                );
                if (!precoUnitario && item.valor) {
                    precoUnitario = numeroMoeda(item.valor) / quantidade;
                }
                if (!precoUnitario && tipo === "produto" && produto) {
                    precoUnitario = Number(produto.preco) || 0;
                }

                novos.push({
                    funcionario_id: funcionario.id,
                    produto_id: produto?.id || null,
                    tipo,
                    descricao: String(nomeItem || produto?.nome || "Consumo antigo").trim(),
                    observacao: String(item.obs || item.observacao || "").trim() || null,
                    quantidade,
                    preco_unitario: Math.max(0, Number(precoUnitario) || 0),
                    data_hora: parseDataHoraAntiga(item)
                });
            }

            if (novos.length) {
                const { error } = await window.supabaseClient.from("consumos").insert(novos);
                if (error) throw error;
            }

            localStorage.setItem("consumos_migracao_supabase_resolvida", "1");
            alert(
                `${novos.length} consumo(s) importado(s) com sucesso.` +
                (ignoradosSemFuncionario
                    ? `\n\n${ignoradosSemFuncionario} registro(s) não foram importados porque o funcionário não foi encontrado no banco.`
                    : "")
            );
            await carregarTudo();
        } catch (erro) {
            console.error("Erro ao importar consumos antigos:", erro);
            definirStatus(`Erro na importação: ${erro.message || erro}`, "erro");
            alert("Não foi possível importar os consumos antigos.\n\n" + (erro.message || erro));
        }
    }

    window.addEventListener("DOMContentLoaded", function () {
        criarBackupPreSupabaseSeNecessario();
        carregarTudo();
    });

    window.recarregarConsumosDoBanco = carregarTudo;
})();

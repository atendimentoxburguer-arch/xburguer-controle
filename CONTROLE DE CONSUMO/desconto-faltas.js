(function () {
    "use strict";

    const pagina = (location.pathname.split("/").pop() || "").toLowerCase();
    const $ = (id) => document.getElementById(id);

    function moeda(valor) {
        return Number(valor || 0).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }

    function numeroMoeda(valor) {
        if (window.formatarMoeda) return window.formatarMoeda(valor);
        const texto = String(valor || "0")
            .replace(/\s/g, "")
            .replace(/^R\$/i, "");
        const normalizado = texto.includes(",")
            ? texto.replace(/\./g, "").replace(",", ".")
            : texto;
        const n = Number(normalizado.replace(/[^0-9.-]/g, ""));
        return Number.isFinite(n) ? Math.abs(n) : 0;
    }

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function dataTela(valor) {
        const m = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return valor || "—";
    }

    function instalarEstilos() {
        if ($("estilo-desconto-falta")) return;
        const style = document.createElement("style");
        style.id = "estilo-desconto-falta";
        style.textContent = `
            .bloco-desconto-falta {
                padding: 14px;
                border: 1px solid #eadede;
                border-radius: 12px;
                background: #fffafa;
            }
            .opcao-desconto-falta {
                display: flex !important;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                margin: 0 !important;
                color: #333 !important;
                font-weight: 800 !important;
            }
            .opcao-desconto-falta input[type="checkbox"] {
                width: 18px !important;
                height: 18px !important;
                margin: 0 !important;
                accent-color: #7a0b0b;
                flex: 0 0 auto;
            }
            .ajuda-desconto-falta {
                margin: 7px 0 0 28px;
                font-size: 12px;
                line-height: 1.4;
                color: #777;
            }
            .campo-valor-desconto-falta {
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid #eee2e2;
            }
            .campo-valor-desconto-falta input { width: 100%; }
            .badge-desconto-falta,
            .badge-sem-desconto {
                display: inline-flex;
                align-items: center;
                min-height: 28px;
                padding: 5px 9px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 800;
                white-space: nowrap;
            }
            .badge-desconto-falta {
                color: #9f1d14;
                background: #fff0ef;
                border: 1px solid #f1c4c0;
            }
            .badge-sem-desconto {
                color: #667085;
                background: #f4f6f8;
                border: 1px solid #e4e7ec;
            }
            @media (max-width: 700px) {
                .bloco-desconto-falta { padding: 13px !important; }
                .ajuda-desconto-falta { margin-left: 28px !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function configurarPaginaFaltas() {
        instalarEstilos();

        const form = $("modal-falta")?.querySelector("form");
        const campoObservacao = $("cad-obs-falta")?.closest(".grupo-input-modal");

        if (form && campoObservacao && !$("cad-descontar-falta")) {
            const bloco = document.createElement("div");
            bloco.className = "grupo-input-modal bloco-desconto-falta";
            bloco.innerHTML = `
                <label class="opcao-desconto-falta" for="cad-descontar-falta">
                    <input type="checkbox" id="cad-descontar-falta">
                    <span>Descontar esta falta do funcionário</span>
                </label>
                <p class="ajuda-desconto-falta">
                    Marque somente quando esta falta realmente gerar desconto em folha.
                </p>
                <div id="grupo-valor-desconto-falta" class="campo-valor-desconto-falta" style="display:none;">
                    <label for="cad-valor-desconto-falta">Valor do desconto (R$) *</label>
                    <input type="text" id="cad-valor-desconto-falta" inputmode="decimal" autocomplete="off" placeholder="0,00">
                </div>
            `;
            form.insertBefore(bloco, campoObservacao);
            $("cad-descontar-falta")?.addEventListener("change", alternarCampoDesconto);
        }

        const cabecalho = document.querySelector("#corpo-tabela-falta")
            ?.closest("table")
            ?.querySelector("thead tr");
        if (cabecalho) {
            const ths = [...cabecalho.querySelectorAll("th")];
            const temDesconto = ths.some(th => th.textContent.trim() === "DESCONTO");
            if (!temDesconto) {
                const thObs = ths.find(th => th.textContent.trim() === "OBSERVAÇÃO");
                const th = document.createElement("th");
                th.textContent = "DESCONTO";
                cabecalho.insertBefore(th, thObs || cabecalho.lastElementChild);
            }
        }

        document.querySelectorAll("#corpo-tabela-falta td[colspan]")
            .forEach(td => td.colSpan = 6);

        const abrirOriginal = window.abrirModalFalta;
        if (typeof abrirOriginal === "function" && !abrirOriginal.__xbDescontoWrapped) {
            const wrapped = function () {
                abrirOriginal();
                const check = $("cad-descontar-falta");
                const campo = $("cad-valor-desconto-falta");
                if (check) check.checked = false;
                if (campo) campo.value = "";
                alternarCampoDesconto();
            };
            wrapped.__xbDescontoWrapped = true;
            window.abrirModalFalta = wrapped;
        }

        window.alternarCampoDescontoFalta = alternarCampoDesconto;
        window.salvarFalta = salvarFaltaComDesconto;
        window.atualizarTabelaFaltas = atualizarTabelaFaltasComDesconto;

        alternarCampoDesconto();
        atualizarTabelaFaltasComDesconto();
    }

    function alternarCampoDesconto() {
        const marcado = Boolean($("cad-descontar-falta")?.checked);
        const grupo = $("grupo-valor-desconto-falta");
        const campo = $("cad-valor-desconto-falta");
        if (grupo) grupo.style.display = marcado ? "block" : "none";
        if (campo) {
            campo.required = marcado;
            if (!marcado) campo.value = "";
        }
    }

    async function salvarFaltaComDesconto(event) {
        event.preventDefault();

        const funcionarioId = $("cad-func-falta")?.value || "";
        const funcionarioNome = $("cad-func-falta")?.selectedOptions?.[0]?.textContent?.trim() || "Funcionário";
        const data = $("cad-data-falta")?.value || "";
        const motivo = $("cad-motivo-falta")?.value.trim() || "";
        const observacao = $("cad-obs-falta")?.value.trim() || "";
        const descontar = Boolean($("cad-descontar-falta")?.checked);
        const valor = descontar
            ? numeroMoeda($("cad-valor-desconto-falta")?.value || "")
            : 0;
        const botao = event.submitter || document.querySelector("#modal-falta .btn-salvar-modal");

        if (!funcionarioId) {
            alert("Selecione um funcionário ativo.");
            return;
        }
        if (!data) {
            alert("Informe a data da falta.");
            return;
        }
        if (descontar && valor <= 0) {
            alert("Informe um valor de desconto maior que zero.");
            $("cad-valor-desconto-falta")?.focus();
            return;
        }

        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Salvando...";
        }

        try {
            const { data: sessao, error: erroSessao } = await window.supabaseClient.auth.getSession();
            if (erroSessao) throw erroSessao;
            if (!sessao?.session) {
                location.replace("login.html");
                return;
            }

            const payload = {
                funcionario_id: funcionarioId,
                data,
                motivo,
                observacao: observacao || null,
                valor_desconto: valor
            };

            const { data: salva, error } = await window.supabaseClient
                .from("faltas")
                .insert(payload)
                .select("id,funcionario_id,data,motivo,observacao,valor_desconto,created_at")
                .single();

            if (error) throw error;

            if (window.registrarNoHistorico) {
                await window.registrarNoHistorico(
                    "Registrou falta",
                    `${funcionarioNome} - ${motivo || "Sem motivo informado"} - ${dataTela(salva?.data || data)} - ${valor > 0 ? `Desconto: ${moeda(valor)}` : "Sem desconto"}`,
                    "📅"
                );
            }

            window.fecharModalFalta?.();
            if (window.recarregarFaltasDoBanco) {
                await window.recarregarFaltasDoBanco();
            } else {
                await atualizarTabelaFaltasComDesconto();
            }
        } catch (erro) {
            console.error("Erro ao salvar falta com desconto:", erro);
            alert("Não foi possível salvar a falta.\n\n" + (erro.message || erro));
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "💾 Salvar";
            }
        }
    }

    async function atualizarTabelaFaltasComDesconto() {
        const corpo = $("corpo-tabela-falta");
        const rodape = $("contador-rodape-falta");
        const contadorTopo = $("contador-topo-faltas");
        if (!corpo || !rodape || !contadorTopo || !window.supabaseClient) return;

        const filtro = $("filtro-funcionario-falta")?.value || "todos";

        try {
            let consulta = window.supabaseClient
                .from("faltas")
                .select("id,funcionario_id,data,motivo,observacao,valor_desconto,created_at")
                .order("data", { ascending: false });

            if (filtro !== "todos") {
                consulta = consulta.eq("funcionario_id", filtro);
            }

            const [respFaltas, respFuncionarios] = await Promise.all([
                consulta,
                window.supabaseClient.from("funcionarios").select("id,nome")
            ]);

            if (respFaltas.error) throw respFaltas.error;
            if (respFuncionarios.error) throw respFuncionarios.error;

            const faltas = Array.isArray(respFaltas.data) ? respFaltas.data : [];
            const nomes = new Map((respFuncionarios.data || []).map(f => [f.id, f.nome]));

            if (!faltas.length) {
                corpo.innerHTML = `
                    <tr id="linha-vazia">
                        <td colspan="6" class="tabela-vazia">
                            <span class="ponto-vermelho-vazio"></span>
                            Nenhum registro de falta
                        </td>
                    </tr>`;
                rodape.textContent = "Total: 0 registros";
                contadorTopo.textContent = "Total: 0 registros";
                return;
            }

            corpo.innerHTML = faltas.map(falta => {
                const nome = nomes.get(falta.funcionario_id) || "Funcionário removido";
                const inicial = nome.charAt(0).toUpperCase();
                const idSeguro = JSON.stringify(falta.id);
                const desconto = Number(falta.valor_desconto || 0);

                return `
                    <tr>
                        <td style="text-align:left;display:flex;align-items:center;gap:10px;padding-left:20px;">
                            <div class="avatar-letra" style="width:30px;height:30px;font-size:13px;">${escaparHtml(inicial)}</div>
                            <span style="font-weight:700;color:#333;">${escaparHtml(nome)}</span>
                        </td>
                        <td style="text-align:left;">📅 ${escaparHtml(dataTela(falta.data))}</td>
                        <td style="text-align:left;">${escaparHtml(falta.motivo || "—")}</td>
                        <td style="text-align:left;">
                            ${desconto > 0
                                ? `<span class="badge-desconto-falta">- ${escaparHtml(moeda(desconto))}</span>`
                                : `<span class="badge-sem-desconto">Sem desconto</span>`}
                        </td>
                        <td style="text-align:left;color:#666;">${escaparHtml(falta.observacao || "—")}</td>
                        <td>
                            <div style="display:flex;gap:10px;justify-content:center;align-items:center;">
                                <button type="button" aria-label="Excluir" onclick='abrirModalExcluir(${idSeguro})' title="Excluir"
                                    style="border:none;background:none;cursor:pointer;font-size:16px;">🗑️</button>
                            </div>
                        </td>
                    </tr>`;
            }).join("");

            rodape.textContent = `Total: ${faltas.length} registro(s)`;
            contadorTopo.textContent = `Total: ${faltas.length} registros`;
        } catch (erro) {
            console.error("Erro ao carregar descontos das faltas:", erro);
        }
    }

    function configurarRelatorios() {
        const original = window.gerarRelatorio;
        if (typeof original !== "function" || original.__xbDescontoWrapped) return;

        const wrapped = async function (manual = false) {
            await original(manual);
            await aplicarDescontosNoRelatorioMensal();
        };
        wrapped.__xbDescontoWrapped = true;
        window.gerarRelatorio = wrapped;

        window.setTimeout(aplicarDescontosNoRelatorioMensal, 350);
    }

    async function aplicarDescontosNoRelatorioMensal() {
        const abaMensal = $("aba-mensal");
        const tabela = $("tabela-relatorio-conteudo");
        if (!abaMensal?.classList.contains("ativa") || !tabela || !window.supabaseClient) return;

        const dataInicio = $("filtro-data-inicio")?.value || "";
        const dataFim = $("filtro-data-fim")?.value || "";
        const funcionarioId = $("filtro-funcionario")?.value || "Todos";

        try {
            let consultaFaltas = window.supabaseClient
                .from("faltas")
                .select("funcionario_id,valor_desconto");

            if (dataInicio) consultaFaltas = consultaFaltas.gte("data", dataInicio);
            if (dataFim) consultaFaltas = consultaFaltas.lte("data", dataFim);
            if (funcionarioId !== "Todos") {
                consultaFaltas = consultaFaltas.eq("funcionario_id", funcionarioId);
            }

            const [respFaltas, respFuncionarios] = await Promise.all([
                consultaFaltas,
                window.supabaseClient.from("funcionarios").select("id,nome")
            ]);

            if (respFaltas.error) throw respFaltas.error;
            if (respFuncionarios.error) throw respFuncionarios.error;

            const descontoPorFuncionario = new Map();
            for (const falta of respFaltas.data || []) {
                descontoPorFuncionario.set(
                    falta.funcionario_id,
                    (descontoPorFuncionario.get(falta.funcionario_id) || 0) + Number(falta.valor_desconto || 0)
                );
            }

            const idPorNome = new Map((respFuncionarios.data || []).map(f => [String(f.nome || "").trim(), f.id]));
            const linhas = [...tabela.querySelectorAll("tr")];
            if (!linhas.length) return;

            const cabecalho = linhas[0];
            const headers = [...cabecalho.querySelectorAll("th")];
            if (headers.length < 7) return;

            headers[4].textContent = "Desconto Consumos";

            const thDescontoFaltas = document.createElement("th");
            thDescontoFaltas.textContent = "Desconto Faltas";
            cabecalho.insertBefore(thDescontoFaltas, headers[6]);

            const thTotal = document.createElement("th");
            thTotal.textContent = "A Descontar";
            cabecalho.insertBefore(thTotal, headers[6]);

            for (const linha of linhas.slice(1)) {
                const celulas = [...linha.querySelectorAll("td")];
                if (celulas.length === 1 && celulas[0].colSpan > 1) {
                    celulas[0].colSpan = 9;
                    continue;
                }
                if (celulas.length < 7) continue;

                const nome = linha.querySelector("td strong")?.textContent?.trim() || "";
                const id = idPorNome.get(nome);
                const salario = numeroMoeda(celulas[2].textContent);
                const descontoConsumos = numeroMoeda(celulas[4].textContent);
                const descontoFaltas = id ? (descontoPorFuncionario.get(id) || 0) : 0;
                const total = descontoConsumos + descontoFaltas;
                const liquido = salario - total;

                celulas[4].textContent = `- ${moeda(descontoConsumos)}`;
                celulas[4].style.color = "#d9534f";
                celulas[4].style.fontWeight = "bold";

                const tdFaltas = document.createElement("td");
                tdFaltas.textContent = descontoFaltas > 0 ? `- ${moeda(descontoFaltas)}` : moeda(0);
                tdFaltas.style.color = descontoFaltas > 0 ? "#d9534f" : "#777";
                tdFaltas.style.fontWeight = "bold";
                linha.insertBefore(tdFaltas, celulas[6]);

                const tdTotal = document.createElement("td");
                tdTotal.textContent = `- ${moeda(total)}`;
                tdTotal.style.color = "#8a4b08";
                tdTotal.style.fontWeight = "bold";
                linha.insertBefore(tdTotal, celulas[6]);

                celulas[6].textContent = moeda(liquido);
                celulas[6].style.color = liquido < 0 ? "#b00020" : "#28a745";
                celulas[6].style.fontWeight = "bold";
            }

            const titulo = $("tabela-titulo-principal");
            if (titulo) titulo.textContent = "Resumo Mensal — Descontos em Folha";
        } catch (erro) {
            console.warn("Não foi possível aplicar desconto de faltas ao relatório:", erro);
        }
    }

    if (pagina === "faltas.html") {
        configurarPaginaFaltas();
    } else if (pagina === "relatorios.html") {
        configurarRelatorios();
    }
})();

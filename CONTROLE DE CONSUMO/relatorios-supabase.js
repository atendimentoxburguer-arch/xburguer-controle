(function () {
    "use strict";

    let tipoAtual = "mensal";
    let listaFuncionarios = [];
    let listaProdutos = [];
    let carregando = false;

    const $ = (id) => document.getElementById(id);

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-relatorios-banco");
        if (!el) return;

        el.textContent = texto;
        if (tipo === "erro") el.style.color = "#b00020";
        else if (tipo === "ok") el.style.color = "#2e7d32";
        else el.style.color = "#777";
    }

    function moeda(valor) {
        return Number(valor || 0).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }

    function numero(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    }

    function valorTotalConsumo(consumo) {
        const total = Number(consumo.valor_total);
        if (Number.isFinite(total)) return total;

        return numero(consumo.preco_unitario) *
            Math.max(1, parseInt(consumo.quantidade, 10) || 1);
    }

    function quantidadeConsumo(consumo) {
        return Math.max(1, parseInt(consumo.quantidade, 10) || 1);
    }

    function dataHoraParaTela(valor) {
        if (!valor) return "—";

        const data = new Date(valor);
        if (Number.isNaN(data.getTime())) return "—";

        return data.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function dataIsoParaTela(valor) {
        if (!valor) return "—";
        const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return String(valor);
    }

    function proximoDiaIso(dataIso) {
        const [ano, mes, dia] = dataIso.split("-").map(Number);
        const d = new Date(ano, mes - 1, dia + 1, 0, 0, 0, 0);

        const a = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${a}-${m}-${dd}`;
    }

    function inicioLocalParaISOString(dataIso) {
        const [ano, mes, dia] = dataIso.split("-").map(Number);
        return new Date(ano, mes - 1, dia, 0, 0, 0, 0).toISOString();
    }

    function periodoParaTela(inicio, fim) {
        if (!inicio || !fim) return "Período: Geral";
        return `Período: ${dataIsoParaTela(inicio)} a ${dataIsoParaTela(fim)}`;
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
        if (!user) return;

        const nomeCompleto =
            user.user_metadata?.nome ||
            user.user_metadata?.full_name ||
            user.email?.split("@")[0] ||
            "Administrador";

        const nomeExibicao = nomeCompleto
            .split(/[._-]/)
            .filter(Boolean)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join(" ");

        const saudacao = document.querySelector(".saudacao");
        const avatar = document.querySelector(".avatar-admin");

        if (saudacao) saudacao.textContent = `Olá, ${nomeExibicao}`;
        if (avatar) avatar.textContent = nomeExibicao.charAt(0).toUpperCase() || "A";
    }

    async function carregarCadastrosBase() {
        const [respFuncionarios, respProdutos] = await Promise.all([
            window.supabaseClient
                .from("funcionarios")
                .select("id,nome,cargo,salario,status")
                .order("nome", { ascending: true }),

            window.supabaseClient
                .from("produtos")
                .select("id,nome,preco,ativo")
                .order("nome", { ascending: true })
        ]);

        if (respFuncionarios.error) throw respFuncionarios.error;
        if (respProdutos.error) throw respProdutos.error;

        listaFuncionarios = Array.isArray(respFuncionarios.data)
            ? respFuncionarios.data
            : [];

        listaProdutos = Array.isArray(respProdutos.data)
            ? respProdutos.data
            : [];

        popularSelectFuncionarios();
    }

    function popularSelectFuncionarios() {
        const select = $("filtro-funcionario");
        if (!select) return;

        const atual = select.value || "Todos";
        select.innerHTML = '<option value="Todos">Todos</option>';

        listaFuncionarios.forEach(funcionario => {
            const option = document.createElement("option");
            option.value = funcionario.id;
            option.textContent =
                funcionario.status === "Inativo"
                    ? `${funcionario.nome} (Inativo)`
                    : funcionario.nome;
            select.appendChild(option);
        });

        if ([...select.options].some(op => op.value === atual)) {
            select.value = atual;
        }
    }

    window.mudarTipoRelatorio = function (tipo) {
        tipoAtual = tipo;

        document.querySelectorAll(".aba-card")
            .forEach(el => el.classList.remove("ativa"));

        $(`aba-${tipo}`)?.classList.add("ativa");

        const grupoFunc = $("grupo-filtro-func");
        if (grupoFunc) {
            grupoFunc.style.display = tipo === "produto" ? "none" : "flex";
        }

        gerarRelatorio();
    };

    async function buscarDadosRelatorio(dataInicio, dataFim, funcionarioId) {
        let consultaConsumos = window.supabaseClient
            .from("consumos")
            .select("id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,valor_total,data_hora,created_at")
            .order("data_hora", { ascending: true });

        let consultaFaltas = window.supabaseClient
            .from("faltas")
            .select("id,funcionario_id,data,motivo,observacao,created_at")
            .order("data", { ascending: true });

        if (dataInicio) {
            consultaConsumos = consultaConsumos.gte(
                "data_hora",
                inicioLocalParaISOString(dataInicio)
            );
            consultaFaltas = consultaFaltas.gte("data", dataInicio);
        }

        if (dataFim) {
            const diaSeguinte = proximoDiaIso(dataFim);

            consultaConsumos = consultaConsumos.lt(
                "data_hora",
                inicioLocalParaISOString(diaSeguinte)
            );
            consultaFaltas = consultaFaltas.lt("data", diaSeguinte);
        }

        // Na aba Produto o filtro de funcionário fica oculto e o relatório
        // considera toda a equipe.
        if (funcionarioId && funcionarioId !== "Todos" && tipoAtual !== "produto") {
            consultaConsumos = consultaConsumos.eq(
                "funcionario_id",
                funcionarioId
            );
            consultaFaltas = consultaFaltas.eq(
                "funcionario_id",
                funcionarioId
            );
        }

        const [respConsumos, respFaltas] = await Promise.all([
            consultaConsumos,
            consultaFaltas
        ]);

        if (respConsumos.error) throw respConsumos.error;
        if (respFaltas.error) throw respFaltas.error;

        return {
            consumos: Array.isArray(respConsumos.data)
                ? respConsumos.data
                : [],
            faltas: Array.isArray(respFaltas.data)
                ? respFaltas.data
                : []
        };
    }

    function atualizarCards(consumos, faltas, funcionariosRelatorio) {
        const totalConsumido = consumos.reduce(
            (soma, consumo) => soma + valorTotalConsumo(consumo),
            0
        );

        $("stat-total-consumido").textContent = moeda(totalConsumido);
        $("stat-num-consumos").textContent = consumos.length.toLocaleString("pt-BR");
        $("stat-total-faltas").textContent = faltas.length.toLocaleString("pt-BR");
        $("stat-funcionarios").textContent = funcionariosRelatorio.length.toLocaleString("pt-BR");
    }

    function funcionariosParaRelatorio(funcionarioId) {
        if (!funcionarioId || funcionarioId === "Todos" || tipoAtual === "produto") {
            return listaFuncionarios;
        }

        return listaFuncionarios.filter(f => f.id === funcionarioId);
    }

    function renderizarMensal(consumos, faltas, funcionarioId) {
        $("tabela-titulo-principal").textContent =
            "Resumo Mensal — Desconto em Folha";

        $("titulo-card-1").textContent = "Total consumido";
        $("titulo-card-2").textContent = "Nº consumos";
        $("titulo-card-4").textContent = "Funcionários";

        const funcionarios = funcionariosParaRelatorio(funcionarioId);
        atualizarCards(consumos, faltas, funcionarios);

        let corpo = "";

        for (const funcionario of funcionarios) {
            const consumosFunc = consumos.filter(
                c => c.funcionario_id === funcionario.id
            );

            const faltasFunc = faltas.filter(
                f => f.funcionario_id === funcionario.id
            );

            const qtdItens = consumosFunc.reduce(
                (soma, c) => soma + quantidadeConsumo(c),
                0
            );

            const totalConsumos = consumosFunc.reduce(
                (soma, c) => soma + valorTotalConsumo(c),
                0
            );

            const salario = numero(funcionario.salario);
            const salarioLiquido = salario - totalConsumos;

            corpo += `
                <tr>
                    <td>
                        <strong>${escaparHtml(funcionario.nome)}</strong>
                        <br>
                        <span style="font-size:11px;color:#666;">
                            ${qtdItens.toLocaleString("pt-BR")} item(ns) consumido(s)
                            ${funcionario.status === "Inativo" ? " • Inativo" : ""}
                        </span>
                    </td>
                    <td>${escaparHtml(funcionario.cargo || "—")}</td>
                    <td>${escaparHtml(moeda(salario))}</td>
                    <td>${qtdItens.toLocaleString("pt-BR")} un.</td>
                    <td style="color:#d9534f;font-weight:bold;">
                        - ${escaparHtml(moeda(totalConsumos))}
                    </td>
                    <td>${faltasFunc.length.toLocaleString("pt-BR")}</td>
                    <td style="color:${salarioLiquido < 0 ? "#b00020" : "#28a745"};font-weight:bold;">
                        ${escaparHtml(moeda(salarioLiquido))}
                    </td>
                </tr>`;
        }

        if (!funcionarios.length) {
            corpo = `
                <tr>
                    <td colspan="7" style="text-align:center;color:#666;padding:20px;">
                        Nenhum funcionário encontrado.
                    </td>
                </tr>`;
        }

        $("tabela-relatorio-conteudo").innerHTML = `
            <tr>
                <th>Funcionário</th>
                <th>Cargo</th>
                <th>Salário Base</th>
                <th>Consumos</th>
                <th>A Descontar</th>
                <th>Faltas</th>
                <th>Salário Líquido</th>
            </tr>
            ${corpo}`;
    }

    function renderizarFuncionario(consumos, faltas, funcionarioId) {
        $("tabela-titulo-principal").textContent =
            "Detalhe Completo de Consumos por Funcionário";

        $("titulo-card-1").textContent = "Total consumido";
        $("titulo-card-2").textContent = "Nº consumos";
        $("titulo-card-4").textContent = "Funcionários";

        const funcionarios = funcionariosParaRelatorio(funcionarioId);
        atualizarCards(consumos, faltas, funcionarios);

        const mapaFuncionarios = new Map(
            listaFuncionarios.map(f => [f.id, f])
        );

        let corpo = consumos.map(consumo => {
            const funcionario = mapaFuncionarios.get(consumo.funcionario_id);
            const tipo = consumo.tipo === "avulso" ? "Avulso" : "Produto";
            const qtd = quantidadeConsumo(consumo);
            const total = valorTotalConsumo(consumo);

            return `
                <tr>
                    <td><strong>${escaparHtml(dataHoraParaTela(consumo.data_hora || consumo.created_at))}</strong></td>
                    <td>${escaparHtml(funcionario?.nome || "Funcionário removido")}</td>
                    <td>
                        <strong>${escaparHtml(consumo.descricao || "—")}</strong>
                        <br>
                        <span style="font-size:11px;color:#666;">
                            ${escaparHtml(tipo)}
                            ${consumo.observacao ? ` • ${escaparHtml(consumo.observacao)}` : ""}
                        </span>
                    </td>
                    <td>${qtd.toLocaleString("pt-BR")} un.</td>
                    <td style="font-weight:bold;color:#800000;">${escaparHtml(moeda(total))}</td>
                </tr>`;
        }).join("");

        if (!consumos.length) {
            corpo = `
                <tr>
                    <td colspan="5" style="text-align:center;color:#666;padding:20px;">
                        Nenhum consumo encontrado para os filtros selecionados.
                    </td>
                </tr>`;
        }

        $("tabela-relatorio-conteudo").innerHTML = `
            <tr>
                <th>Data e Hora</th>
                <th>Funcionário</th>
                <th>Produto / Item</th>
                <th>Quantidade</th>
                <th>Valor Total</th>
            </tr>
            ${corpo}`;
    }

    function renderizarProduto(consumos, faltas) {
        $("tabela-titulo-principal").textContent =
            "Total Consumido por Produto e Itens Avulsos";

        $("titulo-card-1").textContent = "Valor Total";
        $("titulo-card-2").textContent = "Itens Consumidos";
        $("titulo-card-4").textContent = "Itens distintos";

        const grupos = new Map();

        for (const consumo of consumos) {
            const nome = consumo.descricao || "Sem descrição";
            const tipo = consumo.tipo === "avulso" ? "Avulso" : "Produto";
            const chave = `${tipo}|${nome}`;
            const qtd = quantidadeConsumo(consumo);
            const total = valorTotalConsumo(consumo);

            if (!grupos.has(chave)) {
                grupos.set(chave, {
                    nome,
                    tipo,
                    qtd: 0,
                    total: 0
                });
            }

            const grupo = grupos.get(chave);
            grupo.qtd += qtd;
            grupo.total += total;
        }

        const lista = [...grupos.values()].sort(
            (a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR")
        );

        const totalConsumido = lista.reduce((s, x) => s + x.total, 0);
        const totalItens = lista.reduce((s, x) => s + x.qtd, 0);

        $("stat-total-consumido").textContent = moeda(totalConsumido);
        $("stat-num-consumos").textContent = totalItens.toLocaleString("pt-BR");
        $("stat-total-faltas").textContent = faltas.length.toLocaleString("pt-BR");
        $("stat-funcionarios").textContent = lista.length.toLocaleString("pt-BR");

        let corpo = lista.map(item => {
            const medio = item.qtd ? item.total / item.qtd : 0;

            return `
                <tr>
                    <td>
                        <strong>${escaparHtml(item.nome)}</strong>
                        <br>
                        <span style="font-size:11px;color:#666;">${escaparHtml(item.tipo)}</span>
                    </td>
                    <td>${item.qtd.toLocaleString("pt-BR")} un.</td>
                    <td>${escaparHtml(moeda(medio))}</td>
                    <td style="font-weight:bold;color:#800000;">${escaparHtml(moeda(item.total))}</td>
                </tr>`;
        }).join("");

        if (!lista.length) {
            corpo = `
                <tr>
                    <td colspan="4" style="text-align:center;color:#666;padding:20px;">
                        Nenhum consumo registrado no período.
                    </td>
                </tr>`;
        }

        $("tabela-relatorio-conteudo").innerHTML = `
            <tr>
                <th>Produto / Item</th>
                <th>Qtd. Total Consumida</th>
                <th>Valor Unitário Médio</th>
                <th>Valor Total</th>
            </tr>
            ${corpo}`;
    }

    window.gerarRelatorio = async function (manual = false) {
        if (carregando) return;
        carregando = true;

        const botao = $("btn-atualizar-relatorios");
        const botaoVisualizar = document.querySelector(".filtros-box .btn-visualizar");

        for (const btn of [botao, botaoVisualizar]) {
            if (!btn) continue;
            btn.disabled = true;
            btn.dataset.textoOriginal = btn.textContent;
        }

        if (botao) botao.textContent = "Atualizando...";
        if (botaoVisualizar) botaoVisualizar.textContent = "Carregando...";

        definirStatus("Consultando dados diretamente no Supabase...");

        try {
            const session = await garantirSessao();
            atualizarUsuarioTopo(session);

            // Garante que funcionários/produtos reflitam alterações feitas
            // em outro computador antes de gerar o relatório.
            await carregarCadastrosBase();

            const dataInicio = $("filtro-data-inicio").value;
            const dataFim = $("filtro-data-fim").value;
            const funcionarioId = $("filtro-funcionario").value || "Todos";

            if (dataInicio && dataFim && dataInicio > dataFim) {
                throw new Error("A data inicial não pode ser posterior à data final.");
            }

            $("tabela-periodo-sub").textContent =
                periodoParaTela(dataInicio, dataFim);

            const { consumos, faltas } = await buscarDadosRelatorio(
                dataInicio,
                dataFim,
                funcionarioId
            );

            if (tipoAtual === "mensal") {
                renderizarMensal(consumos, faltas, funcionarioId);
            } else if (tipoAtual === "funcionario") {
                renderizarFuncionario(consumos, faltas, funcionarioId);
            } else {
                renderizarProduto(consumos, faltas);
            }

            const agora = new Date().toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });

            definirStatus(`Banco de dados conectado • relatório atualizado às ${agora}`, "ok");
        } catch (erro) {
            console.error("Erro ao gerar relatório:", erro);
            definirStatus(`Erro ao gerar relatório: ${erro.message || erro}`, "erro");

            $("tabela-relatorio-conteudo").innerHTML = `
                <tr>
                    <td style="text-align:center;color:#b00020;padding:24px;">
                        Não foi possível carregar o relatório do banco de dados.
                    </td>
                </tr>`;

            if (manual) {
                alert(
                    "Não foi possível atualizar o relatório.\n\n" +
                    (erro.message || erro)
                );
            }
        } finally {
            carregando = false;

            for (const btn of [botao, botaoVisualizar]) {
                if (!btn) continue;
                btn.disabled = false;
                btn.textContent = btn.dataset.textoOriginal ||
                    (btn === botao ? "↻ Atualizar" : "🔍 Visualizar");
            }
        }
    };

    function definirPeriodoMesAtual() {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        const ultimoDia = new Date(
            ano,
            hoje.getMonth() + 1,
            0
        ).getDate();

        $("filtro-data-inicio").value = `${ano}-${mes}-01`;
        $("filtro-data-fim").value =
            `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;
    }

    window.addEventListener("DOMContentLoaded", async function () {
        definirPeriodoMesAtual();

        try {
            const session = await garantirSessao();
            atualizarUsuarioTopo(session);
            await carregarCadastrosBase();
            await gerarRelatorio();
        } catch (erro) {
            console.error("Falha ao inicializar Relatórios:", erro);
            definirStatus(`Erro de conexão: ${erro.message || erro}`, "erro");
        }
    });

    window.addEventListener("focus", function () {
        // Atualiza automaticamente ao voltar de outra tela, por exemplo
        // depois de registrar um novo consumo.
        gerarRelatorio();
    });
})();

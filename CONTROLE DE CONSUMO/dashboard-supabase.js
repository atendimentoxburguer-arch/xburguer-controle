(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const TAMANHO_PAGINA = 1000;
    let carregando = false;
    let intervaloAtualizacao = null;

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-dashboard-banco");
        if (!el) return;

        el.textContent = texto;

        if (tipo === "erro") el.style.color = "#b00020";
        else if (tipo === "ok") el.style.color = "#2e7d32";
        else el.style.color = "#777";
    }

    function definirCardsComoErro() {
        [
            "card-func-ativos",
            "card-consumos-dia",
            "card-consumos-mes",
            "card-faltas-mes"
        ].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.textContent = "—";
            el.classList.add("dashboard-erro-card");
        });
    }

    function limparErroCards() {
        [
            "card-func-ativos",
            "card-consumos-dia",
            "card-consumos-mes",
            "card-faltas-mes"
        ].forEach(id => $(id)?.classList.remove("dashboard-erro-card"));
    }

    function inicioDiaLocal(data = new Date()) {
        return new Date(
            data.getFullYear(),
            data.getMonth(),
            data.getDate(),
            0, 0, 0, 0
        );
    }

    function inicioMesLocal(data = new Date()) {
        return new Date(
            data.getFullYear(),
            data.getMonth(),
            1,
            0, 0, 0, 0
        );
    }

    function inicioProximoMesLocal(data = new Date()) {
        return new Date(
            data.getFullYear(),
            data.getMonth() + 1,
            1,
            0, 0, 0, 0
        );
    }

    function dataLocalParaISODate(data) {
        const ano = data.getFullYear();
        const mes = String(data.getMonth() + 1).padStart(2, "0");
        const dia = String(data.getDate()).padStart(2, "0");
        return `${ano}-${mes}-${dia}`;
    }

    function formatarMoeda(valor) {
        const numero = Number(valor || 0);
        return numero.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }

    function formatarDataHora(valor) {
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
        if (avatar) avatar.textContent = "XB";

        return user;
    }

    async function carregarConsumosPeriodoPaginados(inicio, fim) {
        const todos = [];
        let offset = 0;

        while (true) {
            const { data, error } = await window.supabaseClient
                .from("consumos")
                .select("quantidade,data_hora,created_at")
                .gte("data_hora", inicio.toISOString())
                .lt("data_hora", fim.toISOString())
                .order("data_hora", { ascending: true })
                .range(offset, offset + TAMANHO_PAGINA - 1);

            if (error) throw error;

            const lote = Array.isArray(data) ? data : [];
            todos.push(...lote);

            if (lote.length < TAMANHO_PAGINA) break;
            offset += TAMANHO_PAGINA;
        }

        return todos;
    }

    function quantidadeDoConsumo(consumo) {
        return Math.max(1, Number(consumo?.quantidade) || 1);
    }

    function somarQuantidades(consumos) {
        return consumos.reduce(
            (total, consumo) => total + quantidadeDoConsumo(consumo),
            0
        );
    }

    function somarQuantidadesNoPeriodo(consumos, inicio, fim) {
        const inicioMs = inicio.getTime();
        const fimMs = fim.getTime();

        return consumos.reduce((total, consumo) => {
            const data = new Date(consumo.data_hora || consumo.created_at);
            const momento = data.getTime();

            if (Number.isNaN(momento) || momento < inicioMs || momento >= fimMs) {
                return total;
            }

            return total + quantidadeDoConsumo(consumo);
        }, 0);
    }

    function renderizarUltimosConsumos(consumos, funcionarios) {
        const listaEl = $("lista-ultimos-registros");
        if (!listaEl) return;

        if (!consumos.length) {
            listaEl.innerHTML = `
                <div style="padding:20px;text-align:center;color:#666;font-size:14px;">
                    Nenhum consumo registrado.
                </div>`;
            return;
        }

        const nomesFuncionarios = new Map(
            funcionarios.map(f => [f.id, f.nome])
        );

        listaEl.innerHTML = consumos.map(item => {
            const nomeFuncionario =
                nomesFuncionarios.get(item.funcionario_id) ||
                "Funcionário";

            const descricao =
                item.descricao ||
                (item.tipo === "avulso" ? "Consumo avulso" : "Produto");

            const quantidade = quantidadeDoConsumo(item);
            const valorTotal = Number(
                item.valor_total ??
                ((Number(item.preco_unitario) || 0) * quantidade)
            ) || 0;

            const inicial = nomeFuncionario.charAt(0).toUpperCase() || "?";
            const dataHora = formatarDataHora(item.data_hora || item.created_at);

            return `
                <div class="item-registro">
                    <div class="avatar-letra">${escaparHtml(inicial)}</div>
                    <div class="detalhes-registro">
                        <span class="nome-registro">${escaparHtml(nomeFuncionario)}</span>
                        <span class="sub-registro">
                            ${escaparHtml(descricao)} (${quantidade} un.)
                            ${item.tipo === "avulso" ? " • avulso" : ""}
                        </span>
                    </div>
                    <div class="valor-data-registro" style="text-align:right;min-width:132px;">
                        <span style="font-size:12px;font-weight:800;color:#7a0b0b;display:block;">
                            ${escaparHtml(formatarMoeda(valorTotal))}
                        </span>
                        <span class="data-reg" style="font-size:10px;font-weight:700;color:#666;display:block;line-height:1.35;">
                            ${escaparHtml(dataHora)}
                        </span>
                    </div>
                </div>`;
        }).join("");
    }

    function renderizarGraficoConsumos(consumos) {
        const eixoXEl = $("grafico-eixo-x");
        const corpoGraficoEl = $("grafico-corpo");
        const eixoYEl = $("grafico-eixo-y");

        if (!eixoXEl || !corpoGraficoEl || !eixoYEl) return;

        const hoje = inicioDiaLocal();
        const dias = [];

        for (let i = 6; i >= 0; i--) {
            const data = new Date(hoje);
            data.setDate(hoje.getDate() - i);
            dias.push(data);
        }

        const chaves = dias.map(data => dataLocalParaISODate(data));
        const totais = new Map(chaves.map(chave => [chave, 0]));

        consumos.forEach(consumo => {
            const data = new Date(consumo.data_hora || consumo.created_at);
            if (Number.isNaN(data.getTime())) return;

            const chave = dataLocalParaISODate(data);
            if (!totais.has(chave)) return;

            totais.set(
                chave,
                totais.get(chave) + quantidadeDoConsumo(consumo)
            );
        });

        const contagens = chaves.map(chave => totais.get(chave) || 0);
        const maiorValor = Math.max(...contagens, 0);

        const topo = Math.max(4, Math.ceil(maiorValor / 4) * 4);
        const passos = [
            topo,
            topo * 0.75,
            topo * 0.5,
            topo * 0.25,
            0
        ];

        eixoYEl.innerHTML = passos
            .map(v => `<span>${Number(v).toLocaleString("pt-BR")}</span>`)
            .join("");

        eixoXEl.innerHTML = dias.map((data, index) => {
            const dia = String(data.getDate()).padStart(2, "0");
            const mes = String(data.getMonth() + 1).padStart(2, "0");
            const hojeClasse = index === dias.length - 1 ? " dia-hoje" : "";
            return `<span class="${hojeClasse}">${dia}/${mes}</span>`;
        }).join("");

        const barras = contagens.map((valor, index) => {
            const altura = (valor / topo) * 100;
            const data = dias[index];
            const dia = String(data.getDate()).padStart(2, "0");
            const mes = String(data.getMonth() + 1).padStart(2, "0");
            const hojeClasse = index === dias.length - 1 ? " hoje" : "";

            return `
                <div class="coluna-grafico${hojeClasse}"
                     title="${dia}/${mes}: ${valor.toLocaleString("pt-BR")} unidade(s) consumida(s)">
                    <div class="barra-grafico" style="height:${altura}%;">
                        <span class="valor-barra">${valor.toLocaleString("pt-BR")}</span>
                    </div>
                </div>`;
        }).join("");

        const linhas = passos.slice(0, 4).map(valor => {
            const bottom = (valor / topo) * 100;
            return `<div class="linha-referencia" style="bottom:${bottom}%;"></div>`;
        }).join("");

        corpoGraficoEl.innerHTML = linhas + barras;
    }

    async function carregarDashboard({ manual = false } = {}) {
        if (carregando) return;

        carregando = true;

        const botao = $("btn-atualizar-dashboard");
        if (botao) {
            botao.disabled = true;
            botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = "Atualizando...";
        }

        definirStatus(
            manual ? "Atualizando dados do banco..." : "Carregando dados do banco..."
        );

        try {
            const session = await garantirSessao();
            atualizarUsuarioTopo(session);

            const agora = new Date();
            const inicioHoje = inicioDiaLocal(agora);
            const inicioAmanha = new Date(inicioHoje);
            inicioAmanha.setDate(inicioAmanha.getDate() + 1);

            const inicioMes = inicioMesLocal(agora);
            const inicioProximoMes = inicioProximoMesLocal(agora);

            const inicio7Dias = new Date(inicioHoje);
            inicio7Dias.setDate(inicio7Dias.getDate() - 6);

            const [
                respFuncAtivos,
                respFuncionarios,
                consumosMes,
                respFaltasMes,
                consumosGrafico,
                respUltimos
            ] = await Promise.all([
                window.supabaseClient
                    .from("funcionarios")
                    .select("id", { count: "exact", head: true })
                    .eq("status", "Ativo"),

                window.supabaseClient
                    .from("funcionarios")
                    .select("id,nome")
                    .order("nome", { ascending: true }),

                carregarConsumosPeriodoPaginados(inicioMes, inicioProximoMes),

                window.supabaseClient
                    .from("faltas")
                    .select("id", { count: "exact", head: true })
                    .gte("data", dataLocalParaISODate(inicioMes))
                    .lt("data", dataLocalParaISODate(inicioProximoMes)),

                carregarConsumosPeriodoPaginados(inicio7Dias, inicioAmanha),

                window.supabaseClient
                    .from("consumos")
                    .select("id,funcionario_id,tipo,descricao,quantidade,preco_unitario,valor_total,data_hora,created_at")
                    .order("data_hora", { ascending: false })
                    .limit(4)
            ]);

            const respostas = [
                respFuncAtivos,
                respFuncionarios,
                respFaltasMes,
                respUltimos
            ];

            const respostaComErro = respostas.find(resp => resp?.error);
            if (respostaComErro?.error) throw respostaComErro.error;

            const totalMes = somarQuantidades(consumosMes);
            const totalDia = somarQuantidadesNoPeriodo(
                consumosMes,
                inicioHoje,
                inicioAmanha
            );

            limparErroCards();

            $("card-func-ativos").textContent = Number(respFuncAtivos.count || 0).toLocaleString("pt-BR");
            $("card-consumos-dia").textContent = totalDia.toLocaleString("pt-BR");
            $("card-consumos-mes").textContent = totalMes.toLocaleString("pt-BR");
            $("card-faltas-mes").textContent = Number(respFaltasMes.count || 0).toLocaleString("pt-BR");

            renderizarUltimosConsumos(
                Array.isArray(respUltimos.data) ? respUltimos.data : [],
                Array.isArray(respFuncionarios.data) ? respFuncionarios.data : []
            );

            renderizarGraficoConsumos(consumosGrafico);

            const horario = new Date().toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });

            definirStatus(`Banco de dados conectado • atualizado às ${horario}`, "ok");
        } catch (erro) {
            console.error("Erro ao carregar Dashboard:", erro);

            definirCardsComoErro();

            const lista = $("lista-ultimos-registros");
            if (lista) {
                lista.innerHTML = `
                    <div style="padding:20px;text-align:center;color:#b00020;font-size:13px;">
                        Não foi possível carregar os dados do banco.
                    </div>`;
            }

            definirStatus(
                `Erro ao carregar o banco: ${erro.message || erro}`,
                "erro"
            );

            if (manual) {
                alert(
                    "Não foi possível atualizar o Dashboard.\n\n" +
                    (erro.message || erro)
                );
            }
        } finally {
            carregando = false;

            if (botao) {
                botao.disabled = false;
                botao.textContent = botao.dataset.textoOriginal || "↻ Atualizar";
            }
        }
    }

    window.atualizarDashboardManual = function () {
        carregarDashboard({ manual: true });
    };

    window.addEventListener("DOMContentLoaded", function () {
        carregarDashboard();

        intervaloAtualizacao = window.setInterval(
            () => carregarDashboard(),
            60000
        );
    });

    window.addEventListener("focus", function () {
        carregarDashboard();
    });

    window.addEventListener("beforeunload", function () {
        if (intervaloAtualizacao) {
            window.clearInterval(intervaloAtualizacao);
        }
    });
})();
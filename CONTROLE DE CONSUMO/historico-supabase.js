(function () {
    "use strict";

    let listaHistorico = [];
    const $ = (id) => document.getElementById(id);

    function escaparHtml(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }


    function nomeUsuarioParaTela(valor) {
        const nome = String(valor || "").trim();

        if (!nome) return "X-Burguer";

        const normalizado = nome.toLowerCase();

        if (
            normalizado === "administrador" ||
            normalizado === "admin" ||
            normalizado.includes("xburguer@") ||
            normalizado.includes("x-burguer@")
        ) {
            return "X-Burguer";
        }

        return nome;
    }

    function definirStatus(texto, tipo = "normal") {
        const el = $("status-historico-banco");
        if (!el) return;

        el.textContent = texto;
        if (tipo === "erro") el.style.color = "#b00020";
        else if (tipo === "ok") el.style.color = "#2e7d32";
        else el.style.color = "#777";
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

    function formatarDataHora(valor) {
        if (!valor) return { data: "—", hora: "—" };

        const data = new Date(valor);
        if (Number.isNaN(data.getTime())) {
            return { data: "—", hora: "—" };
        }

        return {
            data: data.toLocaleDateString("pt-BR"),
            hora: data.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit"
            })
        };
    }

    window.renderizarHistorico = function () {
        const busca = ($("busca-historico")?.value || "").toLowerCase().trim();

        const filtrada = listaHistorico.filter(item => {
            const dh = formatarDataHora(item.data_hora);
            return [
                dh.data,
                dh.hora,
                item.acao,
                item.detalhes,
                item.usuario_nome
            ].join(" ").toLowerCase().includes(busca);
        });

        const corpo = $("corpo-historico");
        const contador = $("contador-historico");
        if (!corpo || !contador) return;

        if (!filtrada.length) {
            corpo.innerHTML = `
                <tr>
                    <td colspan="5" class="tabela-vazia">
                        <span class="ponto-vermelho-vazio"></span>
                        Nenhuma ação registrada
                    </td>
                </tr>`;
        } else {
            corpo.innerHTML = filtrada.map(item => {
                const dh = formatarDataHora(item.data_hora);

                return `
                    <tr>
                        <td>${escaparHtml(dh.data)}</td>
                        <td>${escaparHtml(dh.hora)}</td>
                        <td><strong>${escaparHtml(item.icone || "📝")} ${escaparHtml(item.acao || "Ação")}</strong></td>
                        <td>${escaparHtml(item.detalhes || "—")}</td>
                        <td>${escaparHtml(nomeUsuarioParaTela(item.usuario_nome))}</td>
                    </tr>`;
            }).join("");
        }

        contador.innerText = busca
            ? `Exibindo: ${filtrada.length} de ${listaHistorico.length} registro(s)`
            : `Total: ${listaHistorico.length} registro(s)`;
    };

    async function carregarHistorico() {
        definirStatus("Carregando histórico do banco de dados...");

        try {
            await garantirSessao();

            // Antes de carregar, tenta enviar ações que ficaram pendentes por falta de rede.
            if (window.sincronizarHistoricoPendente) {
                await window.sincronizarHistoricoPendente();
            }

            const { data, error } = await window.supabaseClient
                .from("historico_acoes")
                .select("id,usuario_id,usuario_nome,acao,detalhes,icone,data_hora")
                .order("data_hora", { ascending: false })
                .limit(1000);

            if (error) throw error;

            listaHistorico = Array.isArray(data) ? data : [];
            renderizarHistorico();

            definirStatus(
                `Banco de dados conectado • ${listaHistorico.length} ação(ões) carregada(s) • histórico protegido contra exclusão pelo site`,
                "ok"
            );

            verificarHistoricoAntigo();
        } catch (erro) {
            console.error("Erro ao carregar histórico:", erro);
            definirStatus(`Erro ao carregar do banco: ${erro.message || erro}`, "erro");

            alert(
                "Não foi possível carregar o histórico do banco de dados.\n\n" +
                (erro.message || erro)
            );
        }
    }

    window.recarregarHistorico = carregarHistorico;

    function criarDataHoraAntiga(item) {
        const dataTxt = String(item?.data || "").trim();
        const horaTxt = String(item?.hora || "00:00").trim();

        let dia, mes, ano;

        let m = dataTxt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            dia = Number(m[1]);
            mes = Number(m[2]);
            ano = Number(m[3]);
        } else {
            m = dataTxt.match(/^(\d{2})\/(\d{2})$/);
            if (!m) return null;

            dia = Number(m[1]);
            mes = Number(m[2]);
            ano = new Date().getFullYear();
        }

        const hm = horaTxt.match(/^(\d{1,2}):(\d{2})/);
        const hora = hm ? Number(hm[1]) : 0;
        const minuto = hm ? Number(hm[2]) : 0;

        const d = new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
        if (Number.isNaN(d.getTime())) return null;

        return d.toISOString();
    }

    function lerHistoricoAntigo() {
        try {
            const dados = JSON.parse(localStorage.getItem("historico_xburguer") || "[]");
            return Array.isArray(dados) ? dados : [];
        } catch (_) {
            return [];
        }
    }

    function verificarHistoricoAntigo() {
        // Migração antiga encerrada: não exibe botão de importação no sistema em produção.
        return;
    }

    async function importarHistoricoAntigo() {
        const antigos = lerHistoricoAntigo();

        if (!antigos.length) {
            alert("Não há histórico antigo para importar.");
            return;
        }

        if (!confirm(
            `Importar ${antigos.length} ação(ões) antigas do navegador para o Supabase?\n\n` +
            "O histórico antigo será mantido como backup local mesmo depois da importação."
        )) {
            return;
        }

        definirStatus("Importando histórico antigo...");

        try {
            const session = await garantirSessao();
            const user = session.user;
            const usuarioNome =
                user?.user_metadata?.nome ||
                user?.user_metadata?.full_name ||
                user?.email ||
                "X-Burguer";

            const payload = antigos.map(item => ({
                usuario_id: user.id,
                usuario_nome: String(item.usuario || usuarioNome),
                acao: String(item.acao || "Ação"),
                detalhes: String(item.detalhes || ""),
                icone: String(item.icone || "📝"),
                data_hora: criarDataHoraAntiga(item) || new Date().toISOString()
            }));

            if (payload.length) {
                const { error } = await window.supabaseClient
                    .from("historico_acoes")
                    .insert(payload);

                if (error) throw error;
            }

            localStorage.setItem("historico_migracao_supabase_resolvida", "1");

            alert(
                `${payload.length} ação(ões) antiga(s) importada(s) com sucesso.\n\n` +
                "A cópia antiga do navegador foi preservada como segurança."
            );

            await carregarHistorico();
        } catch (erro) {
            console.error("Erro ao importar histórico antigo:", erro);
            definirStatus(`Erro na importação: ${erro.message || erro}`, "erro");

            alert(
                "Não foi possível importar o histórico antigo.\n\n" +
                (erro.message || erro)
            );
        }
    }

    window.addEventListener("DOMContentLoaded", carregarHistorico);
})();

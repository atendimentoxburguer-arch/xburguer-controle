(function () {
    window.XBURGUER_VERSAO = "3.1.0";
    const isLogin = /(^|\/)login\.html$/i.test(location.pathname);

    // ========================================================
    // X-BURGUER PWA 3.1
    // ========================================================
    let xburguerInstallPrompt = null;

    function xburguerEmModoAplicativo() {
        return (
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true
        );
    }

    function xburguerEhIOS() {
        return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    }

    function atualizarBotaoInstalarPWA() {
        const botao = document.getElementById("btn-instalar-pwa");
        if (!botao) return;

        if (xburguerEmModoAplicativo()) {
            botao.style.display = "none";
            return;
        }

        if (xburguerInstallPrompt || xburguerEhIOS()) {
            botao.style.display = "inline-flex";
        } else {
            botao.style.display = "none";
        }
    }

    function criarBotaoInstalarPWA() {
        if (document.getElementById("btn-instalar-pwa")) return;

        const botao = document.createElement("button");
        botao.type = "button";
        botao.id = "btn-instalar-pwa";
        botao.className = "btn-instalar-pwa";
        botao.innerHTML = "📲 <span>Instalar aplicativo</span>";
        botao.style.display = "none";

        botao.addEventListener("click", async function () {
            if (xburguerInstallPrompt) {
                xburguerInstallPrompt.prompt();

                try {
                    await xburguerInstallPrompt.userChoice;
                } catch (_) {}

                xburguerInstallPrompt = null;
                atualizarBotaoInstalarPWA();
                return;
            }

            if (xburguerEhIOS()) {
                alert(
                    "Para instalar no iPhone/iPad:\n\n" +
                    "1. Abra este site no Safari.\n" +
                    "2. Toque no botão Compartilhar.\n" +
                    "3. Toque em “Adicionar à Tela de Início”.\n" +
                    "4. Confirme em “Adicionar”."
                );
            }
        });

        if (isLogin) {
            const caixa = document.querySelector(".caixa-login");
            const rodape = document.querySelector(".rodape-login");

            if (caixa) {
                if (rodape) {
                    caixa.insertBefore(botao, rodape);
                } else {
                    caixa.appendChild(botao);
                }
            }
        } else {
            const topbar = document.querySelector(".topbar");

            if (topbar) {
                topbar.appendChild(botao);
            }
        }

        atualizarBotaoInstalarPWA();
    }

    window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        xburguerInstallPrompt = event;
        atualizarBotaoInstalarPWA();
    });

    window.addEventListener("appinstalled", function () {
        xburguerInstallPrompt = null;
        atualizarBotaoInstalarPWA();
    });

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            const swUrl = new URL("../service-worker.js", window.location.href);
            const swScope = new URL("../", window.location.href).pathname;

            navigator.serviceWorker.register(swUrl.href, { scope: swScope })
                .catch(function (erro) {
                    console.error("Não foi possível registrar o aplicativo PWA:", erro);
                });
        });
    }


    // A proteção das páginas agora usa a sessão real do Supabase, não sessionStorage.
    async function protegerPagina() {
        if (isLogin) return;
        try {
            const { data, error } = await window.supabaseClient.auth.getSession();
            if (error || !data.session) {
                location.replace("login.html");
            }
        } catch (erro) {
            console.error("Falha ao verificar sessão:", erro);
            location.replace("login.html");
        }
    }

    protegerPagina();

    window.formatarMoeda = function (valor) {
        if (valor === null || valor === undefined || valor === "") return 0;
        if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
        let s = String(valor).trim().replace(/\s/g, "").replace(/^R\$/i, "");
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
    };

    window.moedaBR = function (valor) {
        return window.formatarMoeda(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    };

    // Histórico definitivo: grava as ações diretamente no Supabase.
    // Se houver uma falha temporária de rede, a ação fica em uma fila local
    // e é reenviada automaticamente quando a conexão voltar.
    const CHAVE_HISTORICO_PENDENTE = "historico_pendente_xburguer";

    function lerHistoricoPendente() {
        try {
            const dados = JSON.parse(localStorage.getItem(CHAVE_HISTORICO_PENDENTE) || "[]");
            return Array.isArray(dados) ? dados : [];
        } catch (_) {
            return [];
        }
    }

    function salvarHistoricoPendente(lista) {
        localStorage.setItem(CHAVE_HISTORICO_PENDENTE, JSON.stringify(lista.slice(-500)));
    }

    function adicionarHistoricoPendente(item) {
        const lista = lerHistoricoPendente();
        lista.push(item);
        salvarHistoricoPendente(lista);
    }

    function obterNomeUsuario(user) {
        return (
            user?.user_metadata?.nome ||
            user?.user_metadata?.full_name ||
            user?.email ||
            "Administrador"
        );
    }

    window.registrarNoHistorico = async function (acao, detalhes, icone) {
        const registroBase = {
            acao: String(acao || "Ação"),
            detalhes: String(detalhes || ""),
            icone: String(icone || "📝")
        };

        try {
            if (!window.supabaseClient) {
                throw new Error("Cliente Supabase não carregado.");
            }

            const { data: sessaoData, error: sessaoErro } =
                await window.supabaseClient.auth.getSession();

            if (sessaoErro) throw sessaoErro;

            const user = sessaoData?.session?.user;
            if (!user) throw new Error("Sessão não encontrada.");

            const payload = {
                ...registroBase,
                usuario_id: user.id,
                usuario_nome: obterNomeUsuario(user)
            };

            const { error } = await window.supabaseClient
                .from("historico_acoes")
                .insert(payload);

            if (error) throw error;
            return true;
        } catch (erro) {
            console.warn("Histórico: gravação online indisponível; salvando na fila local.", erro);

            // Mantém a ação para sincronizar depois e evitar perda por falha de rede.
            adicionarHistoricoPendente({
                ...registroBase,
                data_hora: new Date().toISOString()
            });
            return false;
        }
    };

    window.sincronizarHistoricoPendente = async function () {
        const pendentes = lerHistoricoPendente();
        if (!pendentes.length || !window.supabaseClient) return 0;

        try {
            const { data: sessaoData, error: sessaoErro } =
                await window.supabaseClient.auth.getSession();

            if (sessaoErro) throw sessaoErro;

            const user = sessaoData?.session?.user;
            if (!user) return 0;

            const payload = pendentes.map(item => ({
                usuario_id: user.id,
                usuario_nome: obterNomeUsuario(user),
                acao: String(item.acao || "Ação"),
                detalhes: String(item.detalhes || ""),
                icone: String(item.icone || "📝"),
                data_hora: item.data_hora || new Date().toISOString()
            }));

            const { error } = await window.supabaseClient
                .from("historico_acoes")
                .insert(payload);

            if (error) throw error;

            localStorage.removeItem(CHAVE_HISTORICO_PENDENTE);
            return payload.length;
        } catch (erro) {
            console.warn("Histórico: não foi possível sincronizar a fila pendente.", erro);
            return 0;
        }
    };


    function criarAvisoConectividade() {
        if (document.getElementById("aviso-conectividade")) return;

        const aviso = document.createElement("div");
        aviso.id = "aviso-conectividade";
        aviso.className = "aviso-conectividade";
        aviso.setAttribute("role", "status");
        aviso.setAttribute("aria-live", "polite");
        document.body.appendChild(aviso);

        atualizarAvisoConectividade();
    }

    function atualizarAvisoConectividade() {
        const aviso = document.getElementById("aviso-conectividade");
        if (!aviso) return;

        if (navigator.onLine) {
            aviso.classList.remove("visivel");
            aviso.textContent = "";
        } else {
            aviso.textContent = "⚠ Sem conexão com a internet. Consultas e cadastros podem falhar até a conexão voltar.";
            aviso.classList.add("visivel");
        }
    }

    window.addEventListener("online", function () {
        atualizarAvisoConectividade();

        if (window.sincronizarHistoricoPendente) {
            window.sincronizarHistoricoPendente();
        }
    });

    window.addEventListener("offline", atualizarAvisoConectividade);


    function prepararTabelasResponsivas() {
        function aplicarRotulos(tabela) {
            if (!tabela) return;

            let cabecalhos = Array.from(
                tabela.querySelectorAll("thead th")
            ).map(th => th.textContent.trim());

            let linhaCabecalhoInline = null;

            if (!cabecalhos.length) {
                linhaCabecalhoInline = Array.from(
                    tabela.querySelectorAll("tr")
                ).find(tr => tr.querySelector("th"));

                if (linhaCabecalhoInline) {
                    cabecalhos = Array.from(
                        linhaCabecalhoInline.querySelectorAll("th")
                    ).map(th => th.textContent.trim());

                    linhaCabecalhoInline.classList.add("mobile-header-row");
                }
            }

            if (!cabecalhos.length) return;

            tabela.querySelectorAll("tbody tr").forEach(tr => {
                if (tr === linhaCabecalhoInline || tr.querySelector("th")) {
                    tr.classList.add("mobile-header-row");
                    return;
                }

                const celulas = Array.from(tr.children).filter(
                    el => el.tagName === "TD"
                );

                celulas.forEach((td, indice) => {
                    if (Number(td.colSpan || 1) > 1) {
                        td.dataset.label = "";
                        td.classList.add("mobile-cell-full");
                        return;
                    }

                    td.classList.remove("mobile-cell-full");
                    td.dataset.label = cabecalhos[indice] || "";
                });
            });
        }

        document.querySelectorAll("table.tabela-dados").forEach(function (tabela) {
            if (!tabela.closest(".tabela-scroll")) {
                const wrapper = document.createElement("div");
                wrapper.className = "tabela-scroll";
                wrapper.setAttribute("tabindex", "0");
                wrapper.setAttribute("role", "region");
                wrapper.setAttribute(
                    "aria-label",
                    "Tabela responsiva"
                );

                tabela.parentNode.insertBefore(wrapper, tabela);
                wrapper.appendChild(tabela);
            }

            aplicarRotulos(tabela);

            const wrapperTabela = tabela.closest(".tabela-scroll");
            if (wrapperTabela) {
                wrapperTabela.scrollLeft = 0;
            }

            if (!tabela.dataset.responsiveObserver) {
                const observer = new MutationObserver(function () {
                    aplicarRotulos(tabela);
                });

                observer.observe(tabela, {
                    childList: true,
                    subtree: true
                });

                tabela.dataset.responsiveObserver = "1";
            }
        });
    }

    function criarNavegacaoMobile() {
        if (isLogin) return;

        const sidebar = document.querySelector(".sidebar");
        const topbar = document.querySelector(".topbar");
        const sidebarTopo = document.querySelector(".sidebar-topo");

        if (!sidebar || !topbar || !sidebarTopo) return;
        if (document.getElementById("btn-menu-mobile")) return;

        sidebar.id = sidebar.id || "menu-principal";

        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.id = "btn-menu-mobile";
        abrir.className = "btn-menu-mobile";
        abrir.innerHTML = "☰";
        abrir.setAttribute("aria-label", "Abrir menu");
        abrir.setAttribute("aria-controls", sidebar.id);
        abrir.setAttribute("aria-expanded", "false");

        topbar.insertBefore(abrir, topbar.firstChild);

        const fechar = document.createElement("button");
        fechar.type = "button";
        fechar.className = "btn-fechar-menu-mobile";
        fechar.innerHTML = "×";
        fechar.setAttribute("aria-label", "Fechar menu");
        sidebarTopo.appendChild(fechar);

        const overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        overlay.setAttribute("aria-hidden", "true");
        document.body.appendChild(overlay);

        function definirAberto(aberto) {
            document.body.classList.toggle("menu-mobile-aberto", aberto);
            abrir.setAttribute("aria-expanded", aberto ? "true" : "false");
            overlay.setAttribute("aria-hidden", aberto ? "false" : "true");
        }

        abrir.addEventListener("click", function () {
            definirAberto(!document.body.classList.contains("menu-mobile-aberto"));
        });

        fechar.addEventListener("click", function () {
            definirAberto(false);
        });

        overlay.addEventListener("click", function () {
            definirAberto(false);
        });

        sidebar.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", function () {
                definirAberto(false);
            });
        });

        window.addEventListener("resize", function () {
            if (window.innerWidth > 1024) {
                definirAberto(false);
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                definirAberto(false);
            }
        });
    }


    function criarTransicaoSecoes() {
        if (isLogin) return;

        const links = document.querySelectorAll(".sidebar-menu a[href]");

        links.forEach(function (link) {
            link.addEventListener("click", function (event) {
                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    event.altKey ||
                    link.target === "_blank"
                ) {
                    return;
                }

                const href = link.getAttribute("href");
                if (!href || href.startsWith("#")) return;

                const destino = new URL(href, window.location.href);

                if (destino.origin !== window.location.origin) return;

                const atual = new URL(window.location.href);

                if (
                    destino.pathname === atual.pathname &&
                    destino.search === atual.search
                ) {
                    return;
                }

                event.preventDefault();

                document.body.classList.add("trocando-secao");

                window.setTimeout(function () {
                    window.location.href = destino.href;
                }, 120);
            });
        });
    }

    window.addEventListener("DOMContentLoaded", function () {
        document.documentElement.classList.add("site-pronto");
        criarAvisoConectividade();
        criarNavegacaoMobile();
        prepararTabelasResponsivas();
        // Botão visual de instalação removido na versão 3.1.
        criarTransicaoSecoes();

        // Tenta reenviar ações que ficaram pendentes por falha temporária de conexão.
        if (!isLogin && window.sincronizarHistoricoPendente) {
            window.sincronizarHistoricoPendente();
        }

        document.querySelectorAll(".sidebar-sair a").forEach(function (link) {
            link.addEventListener("click", async function (event) {
                event.preventDefault();
                try {
                    await window.supabaseClient.auth.signOut();
                } catch (erro) {
                    console.error("Erro ao sair:", erro);
                }
                sessionStorage.removeItem("xburguer_autenticado");
                document.body.classList.add("saindo-sistema");
                setTimeout(() => location.href = "login.html", 350);
            });
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                document.querySelectorAll(".modal-fundo").forEach(function (modal) {
                    if (getComputedStyle(modal).display !== "none") modal.style.display = "none";
                });
            }
        });
    });
})();

(function () {
    "use strict";

    const inicio = Date.now();
    const janelaDeInicializacao = 12000;
    const maxTentativas = 3;

    let tentativas = 0;
    let timer = null;
    let encerrado = false;
    let observer = null;

    function lista() {
        return document.getElementById("lista-ultimos-registros");
    }

    function cards() {
        return [
            "card-func-ativos",
            "card-consumos-dia",
            "card-consumos-mes",
            "card-faltas-mes"
        ].map(id => document.getElementById(id)).filter(Boolean);
    }

    function ehErroTemporarioVisivel() {
        const el = lista();
        if (!el) return false;
        if ((Date.now() - inicio) > janelaDeInicializacao) return false;
        return /não foi possível carregar os dados do banco/i.test(el.textContent || "");
    }

    function mostrarCarregando() {
        cards().forEach(card => {
            if (card.textContent.trim() === "—") {
                card.textContent = "…";
            }
            card.classList.remove("dashboard-erro-card");
        });

        const el = lista();
        if (el && /não foi possível carregar os dados do banco/i.test(el.textContent || "")) {
            el.innerHTML = `
                <div style="padding:20px;text-align:center;color:#777;font-size:13px;">
                    Carregando dados...
                </div>`;
        }
    }

    function carregouComSucesso() {
        const el = lista();
        if (!el) return false;

        const temErro = /não foi possível carregar os dados do banco/i.test(el.textContent || "");
        const temPlaceholder = cards().some(card => ["—", "…"].includes(card.textContent.trim()));

        return !temErro && !temPlaceholder;
    }

    function encerrar() {
        encerrado = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    function agendarNovaTentativa() {
        if (encerrado || !navigator.onLine) return;
        if (tentativas >= maxTentativas) return;

        tentativas += 1;
        mostrarCarregando();

        if (timer) clearTimeout(timer);
        const atraso = 500 + (tentativas * 350);

        timer = setTimeout(function () {
            // O dashboard já possui um listener de focus que recarrega os dados
            // silenciosamente. Reutilizamos esse fluxo para não exibir alertas.
            window.dispatchEvent(new Event("focus"));
        }, atraso);
    }

    window.addEventListener("DOMContentLoaded", function () {
        const alvo = document.querySelector(".dashboard-container");
        if (!alvo) return;

        observer = new MutationObserver(function () {
            if (carregouComSucesso()) {
                encerrar();
                return;
            }

            if (ehErroTemporarioVisivel()) {
                agendarNovaTentativa();
            }
        });

        observer.observe(alvo, {
            childList: true,
            subtree: true,
            characterData: true
        });

        setTimeout(function () {
            if (!encerrado) {
                encerrar();
            }
        }, janelaDeInicializacao + 1000);
    });
})();

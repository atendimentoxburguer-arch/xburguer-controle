// Configuração pública do Supabase para o frontend.
// A Publishable Key pode ser usada no navegador quando o RLS está configurado.
const SUPABASE_URL = "https://rrslolruacewjijlhpdc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nfsY7E1z8HaTtqPMUhZx_Q_k1BRQe47";

if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );
}

// Complemento 4.2: desconto opcional por falta.
// É carregado somente nas telas que utilizam esse recurso.
(function carregarComplementoDescontoFaltas() {
    const pagina = (location.pathname.split("/").pop() || "").toLowerCase();
    if (pagina !== "faltas.html" && pagina !== "relatorios.html") return;

    window.addEventListener("load", function () {
        if (document.querySelector('script[data-xb-desconto-faltas="1"]')) return;

        const script = document.createElement("script");
        script.src = "desconto-faltas.js?v=4.2.0";
        script.dataset.xbDescontoFaltas = "1";
        document.body.appendChild(script);
    });
})();

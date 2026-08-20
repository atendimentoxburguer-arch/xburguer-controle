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

// O PWA é registrado exclusivamente por app.js/service-worker.js.
// Não registrar outro Service Worker aqui: isso evita dois workers disputando
// o mesmo escopo /xburguer-controle/ e mantém o Controle de Caixa isolado.

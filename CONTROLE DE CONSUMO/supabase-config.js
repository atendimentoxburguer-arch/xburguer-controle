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

// PWA exclusivo do sistema de Consumo. Mantém este app separado do Controle de Caixa.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register(
                '/xburguer-controle/sw-consumo.js?v=1',
                { scope: '/xburguer-controle/', updateViaCache: 'none' }
            );
            reg.update().catch(() => {});
        } catch (erro) {
            console.warn('Não foi possível registrar o PWA X-Burguer Consumo:', erro);
        }
    });
}

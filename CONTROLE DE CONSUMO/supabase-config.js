// Configuração pública do Supabase para o frontend.
// A Publishable Key pode ser usada no navegador quando o RLS está configurado.
const SUPABASE_URL = "https://rrslolruacewjijlhpdc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nfsY7E1z8HaTtqPMUhZx_Q_k1BRQe47";

// ========================================================
// TRAVA DE IDENTIDADE EM TEMPO DE EXECUÇÃO
// ========================================================
(function instalarTravaIdentidadeConsumo() {
    "use strict";

    if (window.__xburguerConsumoIdentityGuard) return;
    window.__xburguerConsumoIdentityGuard = true;

    const APP = "X-Burguer Consumo";
    const EXPECTED_PATH = "/xburguer-controle/";
    const EXPECTED_SUPABASE_HOST = "rrslolruacewjijlhpdc.supabase.co";
    let blocked = false;
    let blockReason = "";

    function renderBlocked() {
        if (!blocked || !document.body || document.getElementById("xbConsumoIdentityBlock")) return;
        const layer = document.createElement("div");
        layer.id = "xbConsumoIdentityBlock";
        layer.setAttribute("role", "alert");
        layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#fff7f7;color:#4e1010;font-family:system-ui,-apple-system,sans-serif";
        layer.innerHTML = '<div style="max-width:620px;background:#fff;border:1px solid #e6cccc;border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(90,10,10,.16)"><strong style="display:block;font-size:20px;margin-bottom:10px">Proteção do X-Burguer Consumo</strong><p style="margin:0;line-height:1.55">O aplicativo bloqueou a inicialização porque detectou uma configuração que não pertence ao Controle de Consumo.</p><p style="margin:10px 0 0;font-size:12px;color:#7a5555">'+String(blockReason).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})+'</p></div>';
        document.body.appendChild(layer);
    }

    function block(reason) {
        blocked = true;
        blockReason = reason || "Identidade do aplicativo inválida.";
        window.__XB_CONSUMO_IDENTITY_BLOCKED__ = true;
        document.documentElement.dataset.xbIdentity = "blocked";
        console.error(APP + ": " + blockReason);
        if (document.body) renderBlocked();
        else document.addEventListener("DOMContentLoaded", renderBlocked, { once: true });
    }

    function validateSupabaseUrl(value) {
        let url;
        try {
            url = new URL(typeof value === "string" ? value : (value && value.url) || "", location.href);
        } catch (_) {
            return true;
        }
        if (url.hostname.endsWith(".supabase.co") && url.hostname !== EXPECTED_SUPABASE_HOST) {
            block("Tentativa de conexão com um projeto Supabase diferente do projeto oficial do Consumo.");
            throw new Error("Conexão bloqueada pela proteção de identidade do X-Burguer Consumo.");
        }
        return true;
    }

    if (location.hostname === "atendimentoxburguer-arch.github.io" && !location.pathname.startsWith(EXPECTED_PATH)) {
        block("O Controle de Consumo foi aberto fora do caminho oficial " + EXPECTED_PATH + ".");
    }

    const configuredHost = new URL(SUPABASE_URL).hostname;
    if (configuredHost !== EXPECTED_SUPABASE_HOST) {
        block("A configuração do Supabase não corresponde ao banco oficial do Consumo.");
        throw new Error("Configuração Supabase bloqueada pela proteção de identidade do Consumo.");
    }

    const nativeFetch = window.fetch && window.fetch.bind(window);
    if (nativeFetch) {
        window.fetch = function(input, init) {
            validateSupabaseUrl(typeof input === "string" ? input : input && input.url);
            if (blocked) return Promise.reject(new Error("Aplicativo bloqueado pela proteção de identidade."));
            return nativeFetch(input, init);
        };
    }

    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket) {
        function GuardedWebSocket(url, protocols) {
            validateSupabaseUrl(url);
            if (blocked) throw new Error("Aplicativo bloqueado pela proteção de identidade.");
            return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        }
        GuardedWebSocket.prototype = NativeWebSocket.prototype;
        try { Object.setPrototypeOf(GuardedWebSocket, NativeWebSocket); } catch (_) {}
        window.WebSocket = GuardedWebSocket;
    }

    window.XBConsumoIdentityGuard = Object.freeze({
        app: "consumo",
        expectedPath: EXPECTED_PATH,
        expectedSupabaseHost: EXPECTED_SUPABASE_HOST,
        validateSupabaseUrl,
        isBlocked: function() { return blocked; }
    });

    if (!blocked) document.documentElement.dataset.xbIdentity = "consumo-ok";
})();

// ========================================================
// ISOLAMENTO TOTAL DE STORAGE DO CONTROLE DE CONSUMO
// ========================================================
// Os dois sistemas ainda usam o mesmo domínio github.io. Por isso, toda chave
// local do Consumo é fisicamente gravada dentro de um namespace próprio.
(function instalarNamespaceConsumo() {
    "use strict";

    if (window.__xburguerConsumoStorageIsolado) return;
    window.__xburguerConsumoStorageIsolado = true;

    const NS = "xburguer_consumo::";
    const proto = Storage.prototype;
    const originalGet = proto.getItem;
    const originalSet = proto.setItem;
    const originalRemove = proto.removeItem;
    const originalKey = proto.key;
    const originalClear = proto.clear;

    function physicalKey(key) {
        key = String(key);
        if (key.startsWith(NS)) return key;
        return NS + key;
    }

    function logicalKey(key) {
        if (key == null) return key;
        key = String(key);
        return key.startsWith(NS) ? key.slice(NS.length) : key;
    }

    function deveMigrar(key) {
        return (
            key === "historico_pendente_xburguer" ||
            key === "xburguer_ultimo_backup_em" ||
            key.startsWith("sb-rrslolruacewjijlhpdc-")
        );
    }

    function migrarStore(store) {
        try {
            const chaves = [];
            for (let i = 0; i < store.length; i++) {
                const key = originalKey.call(store, i);
                if (key && !key.startsWith(NS) && deveMigrar(key)) {
                    chaves.push(key);
                }
            }

            for (const key of chaves) {
                const valor = originalGet.call(store, key);
                const destino = physicalKey(key);
                if (valor !== null && originalGet.call(store, destino) === null) {
                    originalSet.call(store, destino, valor);
                }
                originalRemove.call(store, key);
            }
        } catch (erro) {
            console.warn("Consumo: não foi possível migrar o armazenamento local antigo.", erro);
        }
    }

    migrarStore(localStorage);
    migrarStore(sessionStorage);

    proto.getItem = function (key) {
        return originalGet.call(this, physicalKey(key));
    };

    proto.setItem = function (key, value) {
        return originalSet.call(this, physicalKey(key), value);
    };

    proto.removeItem = function (key) {
        return originalRemove.call(this, physicalKey(key));
    };

    proto.key = function (index) {
        return logicalKey(originalKey.call(this, index));
    };

    // Nunca permite que um clear() executado pelo Consumo apague o storage do Caixa.
    proto.clear = function () {
        const remover = [];
        for (let i = 0; i < this.length; i++) {
            const key = originalKey.call(this, i);
            if (key && key.startsWith(NS)) remover.push(key);
        }
        remover.forEach(key => originalRemove.call(this, key));
    };
})();

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
// Não registrar outro Service Worker aqui.

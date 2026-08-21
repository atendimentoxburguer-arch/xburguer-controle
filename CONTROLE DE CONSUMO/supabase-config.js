// Configuração pública do Supabase para o frontend.
// A Publishable Key pode ser usada no navegador quando o RLS está configurado.
const SUPABASE_URL = "https://rrslolruacewjijlhpdc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nfsY7E1z8HaTtqPMUhZx_Q_k1BRQe47";

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

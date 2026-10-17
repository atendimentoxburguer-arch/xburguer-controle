(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.BackupClientes = api;
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    async function hash(base) {
        const bytes = new TextEncoder().encode(JSON.stringify(base));
        return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    async function montar(dados, projeto, backupId) {
        const base = { sistema: "xburguer-controle-clientes", versao: 2, projeto, backup_id: backupId, exportado_em: new Date().toISOString(), dados };
        return { ...base, integridade: { algoritmo: "SHA-256", hash: await hash(base) } };
    }
    async function validar(pacote, projeto) {
        if (!pacote || typeof pacote !== "object" || Array.isArray(pacote)) throw new Error("Arquivo de backup inválido.");
        if (pacote.projeto !== projeto) throw new Error("Este backup pertence a outro projeto do banco de dados.");
        const proprio = pacote.sistema === "xburguer-controle-clientes" && pacote.versao === 2;
        const completo = pacote.sistema === "XBurguer Controle" && pacote.versao === 3;
        if (!proprio && !completo) throw new Error("Formato de backup de clientes não reconhecido.");
        const { integridade, ...base } = pacote;
        if (integridade?.algoritmo !== "SHA-256" || !integridade.hash || await hash(base) !== integridade.hash) throw new Error("A integridade do arquivo não confere. Selecione uma cópia íntegra.");
        const clientes = proprio ? pacote.dados?.clientes : pacote.dados?.clientes_conta;
        const movimentos = proprio ? pacote.dados?.movimentos : pacote.dados?.movimentos_clientes;
        if (!Array.isArray(clientes) || !Array.isArray(movimentos)) throw new Error("O arquivo deve conter clientes e movimentos juntos.");
        return { clientes_conta: clientes, movimentos_clientes: movimentos };
    }
    return { hash, montar, validar };
});

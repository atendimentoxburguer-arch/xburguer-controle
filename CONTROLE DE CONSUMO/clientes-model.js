(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.ContasClientes = api;
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";

    function centavos(valor) {
        const texto = String(valor ?? "").trim().replace(/^R\$\s*/, "");
        let normalizado;
        if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(texto)) normalizado = texto.replaceAll(".", "").replace(",", ".");
        else if (/^\d+(,\d{1,2})?$/.test(texto)) normalizado = texto.replace(",", ".");
        else if (/^\d+\.\d{1,2}$/.test(texto)) normalizado = texto;
        else throw new Error("Informe um valor válido, como 35,00.");
        const [inteiro, decimal = ""] = normalizado.split(".");
        const resultado = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
        if (!Number.isSafeInteger(resultado) || resultado <= 0 || resultado > 9999999999) {
            throw new Error("O valor deve ser maior que zero e até R$ 99.999.999,99.");
        }
        return resultado;
    }

    const valorCentavos = (valor) => Math.round(Number(valor) * 100);
    const moeda = (valor) => (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    function resumo(movimentos) {
        return movimentos.reduce((r, m) => {
            if (!m.cancelado_em) {
                if (m.tipo === "notinha") r.notinhas += valorCentavos(m.valor);
                else if (m.tipo === "pagamento") r.pagamentos += valorCentavos(m.valor);
            }
            r.saldo = r.notinhas - r.pagamentos;
            return r;
        }, { notinhas: 0, pagamentos: 0, saldo: 0 });
    }

    function extrato(movimentos, inicio, fim) {
        const ordenados = [...movimentos].sort((a, b) =>
            a.data.localeCompare(b.data) || a.criado_em.localeCompare(b.criado_em) || a.id.localeCompare(b.id));
        const anteriores = inicio ? ordenados.filter(m => m.data < inicio) : [];
        const saldoAnterior = resumo(anteriores).saldo;
        let saldo = saldoAnterior;
        const linhas = ordenados.filter(m => (!inicio || m.data >= inicio) && (!fim || m.data <= fim)).map(m => {
            if (!m.cancelado_em) saldo += valorCentavos(m.valor) * (m.tipo === "notinha" ? 1 : -1);
            return { ...m, saldo };
        });
        return { linhas, saldoAnterior, saldoFinal: saldo, ...{ totais: resumo(linhas) } };
    }
    function dataBR(data) {
        const partes = String(data).slice(0, 10).split("-");
        return partes.length === 3 ? partes.reverse().join("/") : "—";
    }
    function escapar(texto) {
        return String(texto ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    return { centavos, valorCentavos, moeda, resumo, extrato, dataBR, escapar };
});

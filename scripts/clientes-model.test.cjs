const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../CONTROLE DE CONSUMO/clientes-model.js');

test('valores brasileiros preservam centavos e rejeitam entradas parciais', () => {
    for (const [entrada, esperado] of [['0,01', 1], ['35,10', 3510], ['1.234,56', 123456], ['1234.56', 123456], ['R$ 25,50', 2550], ['1.234', 123400]]) {
        assert.equal(M.centavos(entrada), esperado, entrada);
    }
    for (const entrada of ['', '0', '-20', '12abc', '1,999', '1e3', 'Infinity', '100000000', '1.23,45']) {
        assert.throws(() => M.centavos(entrada), entrada);
    }
});

const movimento = (id, tipo, data, valor, cancelado_em = null) => ({ id, tipo, data, valor, cancelado_em, criado_em: `${data}T12:00:00Z` });
test('pagamento parcial, quitação e cancelamento preservam os totais', () => {
    const notas = [movimento('a', 'notinha', '2026-01-01', 0.10), movimento('b', 'notinha', '2026-01-02', 0.20)];
    assert.equal(M.resumo(notas).saldo, 30);
    const parcial = [...notas, movimento('c', 'pagamento', '2026-01-03', 0.15)];
    assert.deepEqual(M.resumo(parcial), { notinhas: 30, pagamentos: 15, saldo: 15 });
    assert.equal(M.resumo([...parcial, movimento('d', 'pagamento', '2026-01-03', 0.15)]).saldo, 0);
    assert.equal(M.resumo([...parcial, movimento('e', 'notinha', '2026-01-04', 999, '2026-01-05T00:00:00Z')]).saldo, 15);
});

test('extrato por período traz saldo anterior e ignora cancelados no saldo', () => {
    const lista = [movimento('d', 'notinha', '2026-02-03', 400), movimento('c', 'pagamento', '2026-02-02', 30),
        movimento('b', 'notinha', '2026-02-01', 50, '2026-02-04T00:00:00Z'), movimento('a', 'notinha', '2026-01-30', 100)];
    const e = M.extrato(lista, '2026-02-01', '2026-02-02');
    assert.equal(e.saldoAnterior, 10000);
    assert.equal(e.saldoFinal, 7000);
    assert.deepEqual(e.linhas.map(m => m.saldo), [10000, 7000]);
    assert.deepEqual(e.totais, { notinhas: 0, pagamentos: 3000, saldo: -3000 });
    assert.equal(lista[0].id, 'd');
    assert.equal(M.extrato(lista, '2026-03-01', '').saldoAnterior, 47000);
});

test('extratos não truncam ao passar de mil notinhas e escapam texto de clientes', () => {
    const lista = Array.from({ length: 1001 }, (_, i) => movimento(String(i), 'notinha', '2026-01-01', 0.01));
    assert.equal(M.extrato(lista, '', '').linhas.length, 1001);
    assert.equal(M.resumo(lista).saldo, 1001);
    assert.equal(M.escapar('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
});

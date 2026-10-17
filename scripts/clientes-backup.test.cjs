const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../CONTROLE DE CONSUMO/clientes-backup.js');
const projeto = 'projeto-de-teste.supabase.co';

test('backup de clientes preserva dados, origem e integridade', async () => {
    const dados = { clientes: [{ id: 'cliente' }], movimentos: [{ id: 'notinha', valor: 0.10 }] };
    const pacote = await B.montar(dados, projeto, 'copia-protegida');
    assert.deepEqual(await B.validar(JSON.parse(JSON.stringify(pacote)), projeto), { clientes_conta: dados.clientes, movimentos_clientes: dados.movimentos });
    await assert.rejects(B.validar(pacote, 'outro-projeto.supabase.co'), /outro projeto/);
    const alterado = structuredClone(pacote); alterado.dados.movimentos[0].valor = 100;
    await assert.rejects(B.validar(alterado, projeto), /integridade/);
    delete alterado.integridade;
    await assert.rejects(B.validar(alterado, projeto), /integridade/);
});
test('recuperação aceita clientes do backup completo e rejeita arquivos incompletos', async () => {
    const dados = { clientes_conta: [], movimentos_clientes: [], funcionarios: [] };
    const base = { sistema: 'XBurguer Controle', versao: 3, projeto, dados };
    const pacote = { ...base, integridade: { algoritmo: 'SHA-256', hash: await B.hash(base) } };
    assert.deepEqual(await B.validar(pacote, projeto), { clientes_conta: [], movimentos_clientes: [] });
    delete base.dados.movimentos_clientes;
    await assert.rejects(B.validar({ ...base, integridade: { algoritmo: 'SHA-256', hash: await B.hash(base) } }, projeto), /juntos/);
});

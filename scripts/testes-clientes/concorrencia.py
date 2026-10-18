"""Testa processos PostgreSQL simultâneos. Somente banco CI vazio e descartável."""
import json
import os
import subprocess
from decimal import Decimal
from uuid import uuid4

if os.environ.get('PGDATABASE') != 'clientes_test':
    raise SystemExit('Use somente o banco descartável clientes_test.')

prefixo = "set role authenticated; set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';"
def sql(texto):
    return subprocess.check_output(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', prefixo+texto], text=True).strip()

def literal(objeto):
    return "'" + json.dumps(objeto).replace("'", "''") + "'::jsonb"

cliente = str(uuid4())
sql('select public.salvar_cliente_conta('+literal({'id':cliente,'nome':'Cliente Concorrencia','ativo':True})+');')
sql('select public.registrar_movimento_cliente('+literal({'id':str(uuid4()),'cliente_id':cliente,'tipo':'notinha','data':'2026-01-01','valor':100})+');')

def simultaneos(comandos, erro_esperado):
    processos = [subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',prefixo+"begin;"+comando+"select pg_sleep(1); commit;"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for comando in comandos]
    resultados = [(p.communicate(timeout=30),p.returncode) for p in processos]
    assert sum(codigo == 0 for _,codigo in resultados) == 1, resultados
    falha = next(saidas for saidas,codigo in resultados if codigo != 0)
    assert erro_esperado in falha[1], falha

simultaneos(['select public.registrar_movimento_cliente('+literal({'id':str(uuid4()),'cliente_id':cliente,'tipo':'pagamento','data':'2026-01-02','valor':70,'forma_pagamento':'Pix'})+');' for _ in range(2)], 'saldo atual')
saldo = sql("select sum(case when tipo='notinha' then valor else -valor end) from public.movimentos_clientes where cliente_id='"+cliente+"' and cancelado_em is null;")
assert Decimal(saldo) == Decimal('30'), saldo
simultaneos(['select public.salvar_cliente_conta('+literal({'id':cliente,'nome':nome,'ativo':True,'revisao':1})+');' for nome in ['Concorrente A','Concorrente B']], 'outra tela')
assert sql("select revisao from public.clientes_conta where id='"+cliente+"';") == '2'
print('PASS: pagamentos simultâneos preservam saldo e edições simultâneas não sobrescrevem o cadastro.')

# A mesma notinha não pode receber duas correções divergentes nem ser excluída
# com valores de uma versão anterior, mesmo que as requisições cheguem juntas.
cliente_notinha = str(uuid4())
notinha = str(uuid4())
sql('select public.salvar_cliente_conta('+literal({'id':cliente_notinha,'nome':'Concorrência Notinha','ativo':True})+');')
sql('select public.registrar_movimento_cliente('+literal({'id':notinha,'cliente_id':cliente_notinha,'tipo':'notinha','data':'2026-01-01','valor':100})+');')
original = {'data':'2026-01-01','valor':100,'mesa':'','observacao':'','comanda_assinada':False}
def edicao(valor, base=original):
    return dict(base, id=notinha, cliente_id=cliente_notinha, original=base, valor=valor)
simultaneos(['select public.editar_notinha_cliente('+literal(edicao(valor))+');' for valor in (120,130)], 'outra tela')
atual = json.loads(sql("select jsonb_build_object('data',data,'valor',valor,'mesa',mesa,'observacao',observacao,'comanda_assinada',comanda_assinada) from public.movimentos_clientes where id='"+notinha+"';"))
simultaneos([
    'select public.editar_notinha_cliente('+literal(edicao(150,atual))+');',
    'select public.excluir_notinha_cliente('+literal({'id':notinha,'cliente_id':cliente_notinha,'original':atual})+');'
], 'notinha')

# Reduzir uma notinha para 50 e receber 80 sobre o saldo 100 não podem ambos passar.
cliente_saldo = str(uuid4())
nota_saldo = str(uuid4())
sql('select public.salvar_cliente_conta('+literal({'id':cliente_saldo,'nome':'Concorrência Saldo','ativo':True})+');')
sql('select public.registrar_movimento_cliente('+literal({'id':nota_saldo,'cliente_id':cliente_saldo,'tipo':'notinha','data':'2026-01-01','valor':100})+');')
simultaneos([
    'select public.editar_notinha_cliente('+literal(dict(original,id=nota_saldo,cliente_id=cliente_saldo,original=original,valor=50))+');',
    'select public.registrar_movimento_cliente('+literal({'id':str(uuid4()),'cliente_id':cliente_saldo,'tipo':'pagamento','data':'2026-01-02','valor':80,'forma_pagamento':'Pix'})+');'
], 'pagamento')
assert Decimal(sql("select sum(case when tipo='notinha' then valor else -valor end) from public.movimentos_clientes where cliente_id='"+cliente_saldo+"' and cancelado_em is null;")) >= 0
print('PASS: edições, exclusões e pagamentos simultâneos preservam a notinha mais recente e o saldo.')

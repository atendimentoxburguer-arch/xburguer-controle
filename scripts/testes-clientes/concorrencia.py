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

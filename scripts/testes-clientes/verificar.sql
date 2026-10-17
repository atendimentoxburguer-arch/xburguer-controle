do $$ begin
    if current_setting('xburguer.testes_clientes', true) is distinct from 'ativo' then
        raise exception 'Estes testes exigem um banco descartável preparado por preparar.sql.';
    end if;
end $$;
begin;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.salvar_cliente_conta('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","nome":"Cliente Teste","ativo":true}');
select public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"notinha","data":"2026-01-01","valor":100,"mesa":"12","comanda_assinada":true}');
-- Retry com o mesmo ID deve ser idempotente.
select public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"notinha","data":"2026-01-01","valor":100,"mesa":"12","comanda_assinada":true}');
select public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"pagamento","data":"2026-01-02","valor":30,"forma_pagamento":"Pix"}');
do $$
declare v jsonb; v_saldo numeric;
begin
    v := public.obter_contas_clientes();
    if jsonb_array_length(v->'movimentos') <> 2 then raise exception 'Retry duplicou lançamento.'; end if;
    select sum(case when tipo = 'notinha' then valor else -valor end) into v_saldo from public.movimentos_clientes where cancelado_em is null;
    if v_saldo <> 70 then raise exception 'Saldo parcial incorreto.'; end if;
end $$;
-- Falhas esperadas devem ser efetivamente rejeitadas.
do $$ begin
    begin
        perform public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"pagamento","data":"2026-01-02","valor":70.01,"forma_pagamento":"Pix"}');
        raise exception 'TESTE_FALHOU: aceitou pagamento maior que saldo';
    exception when others then if sqlerrm like 'TESTE_FALHOU:%' then raise; end if; end;
    begin
        perform public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Erro');
        raise exception 'TESTE_FALHOU: cancelou nota já recebida';
    exception when others then if sqlerrm like 'TESTE_FALHOU:%' then raise; end if; end;
    begin
        perform public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"notinha","data":"2026-01-02","valor":0.001}');
        raise exception 'TESTE_FALHOU: aceitou fração de centavo';
    exception when others then if sqlerrm like 'TESTE_FALHOU:%' then raise; end if; end;
    begin
        perform public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"notinha","data":"2026-01-01","valor":101,"mesa":"12","comanda_assinada":true}');
        raise exception 'TESTE_FALHOU: aceitou reuso de ID com outro valor';
    exception when others then if sqlerrm like 'TESTE_FALHOU:%' then raise; end if; end;
    begin
        insert into public.movimentos_clientes (cliente_id, tipo, data, valor) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'notinha', current_date, 10);
        raise exception 'TESTE_FALHOU: permitiu escrita direta';
    exception when insufficient_privilege then null; end;
end $$;
select public.salvar_cliente_conta('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","nome":"Cliente Teste","ativo":false}');
do $$ begin
    begin
        perform public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"notinha","data":"2026-01-02","valor":10}');
        raise exception 'TESTE_FALHOU: permitiu notinha para cliente inativo';
    exception when others then if sqlerrm like 'TESTE_FALHOU:%' then raise; end if; end;
end $$;
-- Inativo continua podendo quitar.
select public.registrar_movimento_cliente('{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","cliente_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tipo":"pagamento","data":"2026-01-03","valor":70,"forma_pagamento":"Dinheiro"}');
do $$ declare v_saldo numeric; begin
    select sum(case when tipo = 'notinha' then valor else -valor end) into v_saldo from public.movimentos_clientes where cancelado_em is null;
    if v_saldo <> 0 then raise exception 'Quitação incorreta.'; end if;
end $$;
select public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Recebimento duplicado');
select public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Correção do pagamento');
select public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Valor incorreto');
select public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Retry');
do $$ begin
    if (select count(*) from public.movimentos_clientes where cancelado_em is not null and cancelado_por = auth.uid() and motivo_cancelamento is not null) <> 3 then
        raise exception 'Cancelamento não preservou auditoria.';
    end if;
end $$;
-- Usuário autenticado fora da lista: não lê as tabelas nem usa qualquer RPC.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
    if (select count(*) from public.clientes_conta) <> 0 or (select count(*) from public.movimentos_clientes) <> 0 then raise exception 'RLS expôs clientes.'; end if;
    begin perform public.obter_contas_clientes(); raise exception 'TESTE_FALHOU: RPC liberada para não autorizado'; exception when insufficient_privilege then null; end;
    begin perform public.salvar_cliente_conta('{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","nome":"Invasor","ativo":true}'); raise exception 'TESTE_FALHOU: cadastro liberado'; exception when insufficient_privilege then null; end;
    begin perform public.registrar_movimento_cliente('{}'); raise exception 'TESTE_FALHOU: movimento liberado'; exception when insufficient_privilege then null; end;
    begin perform public.cancelar_movimento_cliente('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Teste'); raise exception 'TESTE_FALHOU: cancelamento liberado'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
    begin perform public.obter_contas_clientes(); raise exception 'TESTE_FALHOU: RPC liberada para anon'; exception when insufficient_privilege then null; end;
    begin perform 1 from public.clientes_conta; raise exception 'TESTE_FALHOU: tabela liberada para anon'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

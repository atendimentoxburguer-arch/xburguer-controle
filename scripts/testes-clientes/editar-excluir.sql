-- Apenas no banco descartável preparado pelos testes.
do $$ begin
    if current_setting('xburguer.testes_clientes',true) is distinct from 'ativo' then raise exception 'Banco de testes não preparado.'; end if;
    if has_function_privilege('anon','public.editar_notinha_cliente(jsonb)','EXECUTE') or
       has_function_privilege('anon','public.excluir_notinha_cliente(jsonb)','EXECUTE') or
       has_function_privilege('anon','private.alterar_notinha_cliente_impl(jsonb,boolean)','EXECUTE') then
        raise exception 'Anon recebeu acesso às alterações.';
    end if;
    if exists(select 1 from pg_proc where oid in ('public.editar_notinha_cliente(jsonb)'::regprocedure,
        'public.excluir_notinha_cliente(jsonb)'::regprocedure) and prosecdef) then raise exception 'Wrapper público privilegiado.'; end if;
    if has_table_privilege('authenticated','public.movimentos_clientes','UPDATE,DELETE') then raise exception 'Escrita direta permitida.'; end if;
end $$;
begin;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare
    c uuid := gen_random_uuid(); n uuid := gen_random_uuid(); p uuid := gen_random_uuid();
    original jsonb; atual jsonb; payload jsonb; b jsonb; antes integer; criado timestamptz;
begin
    perform public.salvar_cliente_conta(jsonb_build_object('id',c,'nome','Edição e exclusão','ativo',true));
    perform public.registrar_movimento_cliente(jsonb_build_object('id',n,'cliente_id',c,'tipo','notinha','data','2026-01-01','valor',100));
    original := jsonb_build_object('data','2026-01-01','valor',100,'mesa','','observacao','','comanda_assinada',false);
    payload := jsonb_build_object('id',n,'cliente_id',c,'original',original,'data','2026-01-02','valor',120.10,
        'mesa','12','observacao','Correção de comanda','comanda_assinada',true);
    select criado_em into criado from public.movimentos_clientes where id=n;
    perform public.editar_notinha_cliente(payload);
    if not exists(select 1 from public.movimentos_clientes where id=n and cliente_id=c and tipo='notinha' and
        data='2026-01-02' and valor=120.10 and mesa='12' and observacao='Correção de comanda' and comanda_assinada and criado_em=criado) then
        raise exception 'Edição não preservou identidade ou não corrigiu todos os campos.';
    end if;
    if not exists(select 1 from public.auditoria_dados a where registro_id=n and operacao='UPDATE' and
        (a.antes->>'valor')::numeric=100 and (a.depois->>'valor')::numeric=120.10 and usuario_id=auth.uid()) then
        raise exception 'Auditoria não guardou os valores antes/depois.';
    end if;
    select count(*) into antes from public.auditoria_dados where registro_id=n;
    perform public.editar_notinha_cliente(payload);
    if (select count(*) from public.auditoria_dados where registro_id=n)<>antes then raise exception 'Retry duplicou alteração.'; end if;
    begin
        perform public.editar_notinha_cliente(jsonb_set(payload,'{valor}','150'));
        raise exception 'TESTE_FALHOU: sobrescreveu edição recente';
    exception when serialization_failure then null; end;
    begin
        perform public.excluir_notinha_cliente(payload);
        raise exception 'TESTE_FALHOU: excluiu versão alterada';
    exception when serialization_failure then null; end;
    atual := (payload-'id'-'cliente_id'-'original');
    payload := jsonb_set(payload,'{original}',atual);
    begin
        perform public.editar_notinha_cliente(jsonb_set(payload,'{valor}','1.001'));
        raise exception 'TESTE_FALHOU: aceitou fração de centavo';
    exception when others then if sqlerrm not like '%duas casas%' then raise; end if; end;
    begin
        perform public.editar_notinha_cliente(jsonb_set(payload,'{cliente_id}',to_jsonb(gen_random_uuid())));
        raise exception 'TESTE_FALHOU: aceitou outro cliente';
    exception when others then if sqlerrm not like '%deste cliente%' then raise; end if; end;
    perform public.registrar_movimento_cliente(jsonb_build_object('id',p,'cliente_id',c,'tipo','pagamento','data','2026-01-03','valor',110,'forma_pagamento','Pix'));
    begin
        perform public.editar_notinha_cliente(jsonb_set(payload,'{valor}','100'));
        raise exception 'TESTE_FALHOU: edição deixou saldo negativo';
    exception when others then if sqlerrm not like '%pagamentos já recebidos%' then raise; end if; end;
    begin
        perform public.excluir_notinha_cliente(payload);
        raise exception 'TESTE_FALHOU: exclusão deixou saldo negativo';
    exception when others then if sqlerrm not like '%pagamentos já recebidos%' then raise; end if; end;
    begin
        perform public.editar_notinha_cliente(jsonb_set(payload,'{id}',to_jsonb(p)));
        raise exception 'TESTE_FALHOU: editou pagamento pela RPC de notinha';
    exception when others then if sqlerrm not like '%deste cliente%' then raise; end if; end;
    perform public.cancelar_movimento_cliente(p,'Pagamento duplicado');
    perform public.excluir_notinha_cliente(payload);
    if not exists(select 1 from public.movimentos_clientes where id=n and valor=120.10 and
        cancelado_em is not null and cancelado_por=auth.uid() and motivo_cancelamento='Exclusão solicitada pelo usuário.') then
        raise exception 'Exclusão perdeu registro ou autor.';
    end if;
    select count(*) into antes from public.auditoria_dados where registro_id=n;
    perform public.excluir_notinha_cliente(payload);
    if (select count(*) from public.auditoria_dados where registro_id=n)<>antes then raise exception 'Retry duplicou exclusão.'; end if;
    begin
        perform public.editar_notinha_cliente(payload);
        raise exception 'TESTE_FALHOU: editou notinha excluída';
    exception when others then if sqlerrm not like '%já foi excluída%' then raise; end if; end;
    if (select sum(case when tipo='notinha' then valor else -valor end) from public.movimentos_clientes where cliente_id=c and cancelado_em is null) is not null then
        raise exception 'Exclusão não retirou valores do saldo.';
    end if;
    select conteudo into b from public.criar_backup_protegido('teste-editar-excluir');
    if not exists(select 1 from jsonb_array_elements(b->'dados'->'movimentos_clientes') x where x->>'id'=n::text and
        (x->>'valor')::numeric=120.10 and x->>'cancelado_em' is not null) then raise exception 'Backup perdeu exclusão/edição.'; end if;
    perform public.restaurar_contas_clientes(b->'dados');
    if (select cancelado_em from public.movimentos_clientes where id=n) is null then raise exception 'Recuperação reativou notinha excluída.'; end if;
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
    begin perform public.editar_notinha_cliente('{}'); raise exception 'TESTE_FALHOU: edição não autorizada'; exception when insufficient_privilege then null; end;
    begin perform public.excluir_notinha_cliente('{}'); raise exception 'TESTE_FALHOU: exclusão não autorizada'; exception when insufficient_privilege then null; end;
    begin perform private.alterar_notinha_cliente_impl('{}',false); raise exception 'TESTE_FALHOU: helper não autorizado'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

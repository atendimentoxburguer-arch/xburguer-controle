-- Somente no banco descartável preparado pelos testes.
do $$ begin
    if current_setting('xburguer.testes_clientes',true) is distinct from 'ativo' then raise exception 'Banco de testes não preparado.'; end if;
end $$;
begin;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare
    c uuid := gen_random_uuid(); n uuid := gen_random_uuid(); p uuid := gen_random_uuid();
    b jsonb; alterado jsonb; r jsonb; antes integer; cliente_invalido uuid := gen_random_uuid();
begin
    perform public.salvar_cliente_conta(jsonb_build_object('id',c,'nome','João Teste','telefone','(11) 99999-0000','ativo',true));
    perform public.salvar_cliente_conta(jsonb_build_object('id',c,'nome','João Atualizado','telefone','(11) 99999-0000','ativo',true,'revisao',1));
    -- A resposta pode se perder: repetir o mesmo conteúdo não incrementa a revisão.
    perform public.salvar_cliente_conta(jsonb_build_object('id',c,'nome','João Atualizado','telefone','(11) 99999-0000','ativo',true,'revisao',1));
    if (select revisao from public.clientes_conta where id=c) <> 2 then raise exception 'Retry alterou revisão.'; end if;
    begin
        perform public.salvar_cliente_conta(jsonb_build_object('id',c,'nome','Edição antiga','ativo',true,'revisao',1));
        raise exception 'TESTE_FALHOU: perdeu uma edição concorrente';
    exception when serialization_failure then null; end;
    begin
        perform public.salvar_cliente_conta(jsonb_build_object('id',gen_random_uuid(),'nome','  JOÃO   ATUALIZADO  ','telefone','11999990000','ativo',true));
        raise exception 'TESTE_FALHOU: duplicou cadastro';
    exception when unique_violation then null; end;
    perform public.registrar_movimento_cliente(jsonb_build_object('id',n,'cliente_id',c,'tipo','notinha','data','2026-01-01','valor',31.50));
    perform public.registrar_movimento_cliente(jsonb_build_object('id',p,'cliente_id',c,'tipo','pagamento','data','2026-01-02','valor',10,'forma_pagamento','Pix'));
    select conteudo into b from public.criar_backup_protegido('automatico-diario');
    if jsonb_array_length(b->'dados'->'clientes_conta') <> 1 or jsonb_array_length(b->'dados'->'movimentos_clientes') <> 2 then raise exception 'Backup diário não incluiu clientes.'; end if;
    if not exists(select 1 from public.backups_internos where conteudo=b and hash_sha256=encode(extensions.digest(b::text,'sha256'),'hex')) then raise exception 'Hash do backup inválido.'; end if;
    if (select count(*) from public.auditoria_dados where tabela in ('clientes_conta','movimentos_clientes') and usuario_id=auth.uid()) <> 4 then raise exception 'Auditoria de cliente incompleta.'; end if;

    -- Simulação de perda de registro pelo dono deste banco temporário.
    delete from public.movimentos_clientes where id=p;
    select count(*) into antes from public.backups_internos;
    r := public.restaurar_contas_clientes(b->'dados');
    if (r->>'movimentos_clientes')::int <> 1 or (r->>'clientes_conta')::int <> 0 then raise exception 'Recuperação não inseriu apenas o ausente.'; end if;
    if (select count(*) from public.backups_internos) <> antes+2 then raise exception 'Faltou cópia antes/depois da recuperação.'; end if;
    if (select sum(case when tipo='notinha' then valor else -valor end) from public.movimentos_clientes where cliente_id=c and cancelado_em is null) <> 21.50 then raise exception 'Saldo restaurado incorreto.'; end if;
    perform public.cancelar_movimento_cliente(p,'Pagamento errado');
    r := public.restaurar_contas_clientes(b->'dados');
    if (r->>'total')::int <> 0 or (select cancelado_em from public.movimentos_clientes where id=p) is null then raise exception 'Recuperação ressuscitou pagamento cancelado.'; end if;

    alterado := jsonb_set(b->'dados','{movimentos_clientes,0,valor}','999'::jsonb);
    select count(*) into antes from public.backups_internos;
    begin
        perform public.restaurar_contas_clientes(alterado);
        raise exception 'TESTE_FALHOU: aceitou ID com valor conflitante';
    exception when others then if sqlerrm not like '%conteúdo diferente%' then raise; end if; end;
    if (select count(*) from public.backups_internos) <> antes then raise exception 'Falha de recuperação não foi transacional.'; end if;

    alterado := jsonb_build_object('clientes_conta',jsonb_build_array(jsonb_build_object('id',cliente_invalido,'nome','Recuperação inválida','telefone','','observacao','','ativo',true,'criado_em',now(),'atualizado_em',now(),'criado_por',auth.uid(),'revisao',1)),
        'movimentos_clientes',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'cliente_id',cliente_invalido,'tipo','pagamento','data','2026-01-01','valor',999,'mesa','','observacao','','comanda_assinada',false,'forma_pagamento','Pix','criado_em',now(),'criado_por',auth.uid())));
    begin
        perform public.restaurar_contas_clientes(alterado);
        raise exception 'TESTE_FALHOU: recuperou pagamento sem a notinha';
    exception when others then if sqlerrm not like '%saldo negativo%' then raise; end if; end;
    if exists(select 1 from public.clientes_conta where id=cliente_invalido) then raise exception 'Recuperação ficou parcialmente aplicada.'; end if;

    -- A recuperação completa agora reconhece clientes; arquivos antigos continuam aceitos.
    r := public.restaurar_backup_seguro(b->'dados');
    if (r->>'total')::int <> 0 or not(r ? 'clientes_conta') then raise exception 'Recuperação completa perdeu integração.'; end if;
    r := public.restaurar_backup_seguro((b->'dados')-'clientes_conta'-'movimentos_clientes');
    if (select count(*) from public.clientes_conta) <> 1 then raise exception 'Backup antigo alterou clientes.'; end if;
    if has_function_privilege('anon','public.restaurar_contas_clientes(jsonb)','EXECUTE') then raise exception 'Anon pode recuperar clientes.'; end if;
end $$;
set role authenticated;
-- Exercita a recuperação completa com as permissões reais do aplicativo: sem SELECT em auth.users.
do $$ declare r jsonb; begin
    if has_table_privilege('authenticated','auth.users','SELECT') then raise exception 'O teste não representa as permissões do aplicativo.'; end if;
    r := public.restaurar_backup_seguro('{"funcionarios":[],"produtos":[],"consumos":[],"faltas":[],"historico_acoes":[],"clientes_conta":[],"movimentos_clientes":[]}');
    if (r->>'total')::int <> 0 then raise exception 'Recuperação completa inesperada.'; end if;
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
    begin perform public.restaurar_contas_clientes('{"clientes_conta":[],"movimentos_clientes":[]}'); raise exception 'TESTE_FALHOU: usuário indevido recuperou clientes'; exception when insufficient_privilege then null; end;
    begin perform private.restaurar_contas_clientes_impl('{"clientes_conta":[],"movimentos_clientes":[]}'); raise exception 'TESTE_FALHOU: helper permitiu acesso indevido'; exception when insufficient_privilege then null; end;
    begin perform public.restaurar_backup_seguro('{}'); raise exception 'TESTE_FALHOU: recuperação completa permitiu acesso indevido'; exception when insufficient_privilege then null; end;
    if (select count(*) from public.auditoria_dados) <> 0 then raise exception 'Auditoria expôs dados.'; end if;
end $$;
reset role;
rollback;

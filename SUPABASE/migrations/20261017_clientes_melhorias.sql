-- Melhorias da área de clientes. Aplicar depois de 20261017_clientes_notinhas.sql.
-- Integração baseada nas funções reais do XBurguer Controle, consultadas em 17/10/2026.
-- A verificação abaixo impede substituir silenciosamente uma definição que tenha mudado.
begin;
do $$ begin
if md5(regexp_replace(pg_get_functiondef('private.criar_backup_protegido_impl(text,uuid)'::regprocedure), '\s', '', 'g')) <> 'fdeea24dc3cdf795c03bbf30578cd17f' then raise exception 'A definição de criar_backup_protegido_impl mudou. Revise a migration antes de aplicá-la.'; end if;
if md5(regexp_replace(pg_get_functiondef('public.restaurar_backup_seguro(jsonb)'::regprocedure), '\s', '', 'g')) <> '731044c803ef0ca491d79e78fb3b6f2c' then raise exception 'A definição de restaurar_backup_seguro mudou. Revise a migration antes de aplicá-la.'; end if;
end $$;
alter table public.clientes_conta add column revisao integer not null default 1 check (revisao > 0);
create unique index clientes_conta_nome_telefone_unicos on public.clientes_conta
    (lower(regexp_replace(btrim(nome), '\s+', ' ', 'g')), regexp_replace(telefone, '[^0-9]', '', 'g'));
create or replace function public.salvar_cliente_conta(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_atual public.clientes_conta%rowtype; v_nome text; v_tel text; v_obs text; v_ativo boolean;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if jsonb_typeof(p_dados) is distinct from 'object' or jsonb_typeof(p_dados->'ativo') is distinct from 'boolean' then
        raise exception 'Informe nome e situação do cliente.';
    end if;
    v_id := (p_dados->>'id')::uuid;
    v_nome := btrim(p_dados->>'nome'); v_tel := btrim(coalesce(p_dados->>'telefone', ''));
    v_obs := btrim(coalesce(p_dados->>'observacao', '')); v_ativo := (p_dados->>'ativo')::boolean;
    if v_id is null or v_nome is null or length(v_nome) not between 1 and 120 then raise exception 'Informe o nome do cliente (até 120 caracteres).'; end if;
    perform pg_advisory_xact_lock_shared(1747835, 1);
    perform pg_advisory_xact_lock(1747836, hashtext(v_id::text));
    select * into v_atual from public.clientes_conta where id = v_id for update;
    if found then
        if (v_atual.nome, v_atual.telefone, v_atual.observacao, v_atual.ativo) = (v_nome, v_tel, v_obs, v_ativo) then return v_id; end if;
        if (p_dados->>'revisao')::integer is distinct from v_atual.revisao then
            raise exception 'Este cadastro foi alterado em outra tela. Feche o formulário, atualize a lista e confira os dados antes de editar.' using errcode = '40001';
        end if;
        update public.clientes_conta set nome=v_nome, telefone=v_tel, observacao=v_obs, ativo=v_ativo,
            revisao=revisao+1, atualizado_em=clock_timestamp() where id=v_id;
    else
        if p_dados->>'revisao' is not null then raise exception 'Cliente não encontrado. Atualize a lista.'; end if;
        insert into public.clientes_conta(id,nome,telefone,observacao,ativo) values(v_id,v_nome,v_tel,v_obs,v_ativo);
    end if;
    return v_id;
exception when unique_violation then
    raise exception 'Já existe um cliente com este nome e telefone. Localize o cadastro existente.' using errcode = '23505';
end $$;

create or replace function public.obter_contas_clientes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'versao', 2,
        'clientes', coalesce((select jsonb_agg(c order by c.nome, c.id) from public.clientes_conta c), '[]'::jsonb),
        'movimentos', coalesce((select jsonb_agg(m order by m.data, m.criado_em, m.id) from public.movimentos_clientes m), '[]'::jsonb)
    );
end $$;
create or replace function public.registrar_movimento_cliente(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid := (p_dados->>'id')::uuid;
    v_cliente uuid := (p_dados->>'cliente_id')::uuid;
    v_tipo text := p_dados->>'tipo';
    v_valor numeric := (p_dados->>'valor')::numeric;
    v_data date := (p_dados->>'data')::date;
    v_ativo boolean;
    v_saldo numeric;
    v_anterior public.movimentos_clientes%rowtype;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if v_id is null or v_tipo is null or v_tipo not in ('notinha', 'pagamento') or
       v_valor is null or v_valor <= 0 or v_valor > 99999999.99 or v_valor <> round(v_valor, 2) or
       v_data is null or v_data < date '1900-01-01' or v_data > (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'Confira o tipo, a data e o valor (até duas casas decimais).';
    end if;
    perform pg_advisory_xact_lock_shared(1747835, 1);
    -- O mesmo bloqueio serializa pagamentos, cancelamentos e alteração do cadastro.
    select ativo into v_ativo from public.clientes_conta where id = v_cliente for update;
    if not found then raise exception 'Cliente não encontrado.'; end if;
    select * into v_anterior from public.movimentos_clientes where id = v_id;
    if found then
        if v_anterior.cliente_id = v_cliente and v_anterior.tipo = v_tipo and
           v_anterior.valor = v_valor and v_anterior.data = v_data and
           v_anterior.mesa = btrim(coalesce(p_dados->>'mesa', '')) and
           v_anterior.observacao = btrim(coalesce(p_dados->>'observacao', '')) and
           v_anterior.comanda_assinada = coalesce((p_dados->>'comanda_assinada')::boolean, false) and
           v_anterior.forma_pagamento = coalesce(p_dados->>'forma_pagamento', '') then
            return v_id; -- Repetição de uma requisição após perda de conexão.
        end if;
        raise exception 'Identificador já utilizado por outro lançamento. Atualize a página.';
    end if;
    if v_tipo = 'notinha' and not v_ativo then raise exception 'Reative o cliente antes de lançar uma notinha.'; end if;
    select coalesce(sum(case when tipo = 'notinha' then valor else -valor end), 0)
        into v_saldo from public.movimentos_clientes where cliente_id = v_cliente and cancelado_em is null;
    if v_tipo = 'pagamento' and v_valor > v_saldo then
        raise exception 'O pagamento ultrapassa o saldo atual. Atualize o extrato e confira o valor.';
    end if;
    insert into public.movimentos_clientes (id, cliente_id, tipo, data, valor, mesa, observacao, comanda_assinada, forma_pagamento)
    values (v_id, v_cliente, v_tipo, v_data, v_valor, btrim(coalesce(p_dados->>'mesa', '')),
        btrim(coalesce(p_dados->>'observacao', '')), coalesce((p_dados->>'comanda_assinada')::boolean, false),
        coalesce(p_dados->>'forma_pagamento', ''));
    return v_id;
end $$;
create or replace function public.cancelar_movimento_cliente(p_id uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mov public.movimentos_clientes%rowtype; v_saldo numeric;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if p_motivo is null or length(btrim(p_motivo)) not between 1 and 500 then
        raise exception 'Informe o motivo do cancelamento (até 500 caracteres).';
    end if;
    perform pg_advisory_xact_lock_shared(1747835, 1);
    select * into v_mov from public.movimentos_clientes where id = p_id;
    if not found then raise exception 'Lançamento não encontrado.'; end if;
    perform 1 from public.clientes_conta where id = v_mov.cliente_id for update;
    select * into v_mov from public.movimentos_clientes where id = p_id for update;
    if v_mov.cancelado_em is not null then return p_id; end if;
    select coalesce(sum(case when tipo = 'notinha' then valor else -valor end), 0)
        into v_saldo from public.movimentos_clientes where cliente_id = v_mov.cliente_id and cancelado_em is null;
    if v_mov.tipo = 'notinha' and v_mov.valor > v_saldo then
        raise exception 'O cancelamento deixaria o saldo do cliente negativo. Confira e corrija os pagamentos antes de cancelar esta notinha.';
    end if;
    update public.movimentos_clientes set cancelado_em = now(), cancelado_por = auth.uid(),
        motivo_cancelamento = btrim(p_motivo) where id = p_id;
    return p_id;
end $$;
create function private.restaurar_contas_clientes_impl(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_clientes integer := 0; n_movimentos integer := 0;
begin
    if public.usuario_autorizado_atual() is distinct from true then raise exception 'Usuário não autorizado.' using errcode='42501'; end if;
    if not (p_dados ? 'clientes_conta' or p_dados ? 'movimentos_clientes') then
        return jsonb_build_object('clientes_conta',0,'movimentos_clientes',0,'total',0);
    end if;
    if jsonb_typeof(p_dados->'clientes_conta') is distinct from 'array' or jsonb_typeof(p_dados->'movimentos_clientes') is distinct from 'array' then
        raise exception 'O backup deve conter clientes e movimentos juntos.';
    end if;
    if octet_length(jsonb_build_object('clientes_conta',p_dados->'clientes_conta','movimentos_clientes',p_dados->'movimentos_clientes')::text) > 20971520 then raise exception 'O backup de clientes ultrapassa o limite de 20 MB.'; end if;
    perform pg_advisory_xact_lock(1747835,1);
    if exists(select 1 from jsonb_array_elements(p_dados->'clientes_conta') c group by c->>'id' having c->>'id' is null or count(*)>1) or
       exists(select 1 from jsonb_array_elements(p_dados->'movimentos_clientes') m group by m->>'id' having m->>'id' is null or count(*)>1) then
        raise exception 'O backup contém identificadores ausentes ou repetidos.';
    end if;
    if exists(select 1 from jsonb_array_elements(p_dados->'movimentos_clientes') m where
        (m->>'valor')::numeric is null or (m->>'valor')::numeric <> round((m->>'valor')::numeric,2) or
        (m->>'data')::date not between date '1900-01-01' and (now() at time zone 'America/Sao_Paulo')::date) then
        raise exception 'O backup contém valor ou data inválidos.';
    end if;
    if exists(select 1 from jsonb_populate_recordset(null::public.movimentos_clientes,p_dados->'movimentos_clientes') r
        join public.movimentos_clientes a using(id) where
        (a.cliente_id,a.tipo,a.data,a.valor,a.mesa,a.observacao,a.comanda_assinada,a.forma_pagamento,a.criado_em,a.criado_por)
        is distinct from (r.cliente_id,r.tipo,r.data,r.valor,r.mesa,r.observacao,r.comanda_assinada,r.forma_pagamento,r.criado_em,r.criado_por)) then
        raise exception 'Há um lançamento com o mesmo ID e conteúdo diferente. A recuperação foi cancelada.';
    end if;
    insert into public.clientes_conta(id,nome,telefone,observacao,ativo,criado_em,atualizado_em,criado_por,revisao)
    select r.id,r.nome,r.telefone,r.observacao,r.ativo,r.criado_em,r.atualizado_em,r.criado_por,coalesce(r.revisao,1)
    from jsonb_populate_recordset(null::public.clientes_conta,p_dados->'clientes_conta') r
    where not exists(select 1 from public.clientes_conta a where a.id=r.id);
    get diagnostics n_clientes = row_count;
    insert into public.movimentos_clientes
    select r.* from jsonb_populate_recordset(null::public.movimentos_clientes,p_dados->'movimentos_clientes') r
    where not exists(select 1 from public.movimentos_clientes a where a.id=r.id);
    get diagnostics n_movimentos = row_count;
    if exists(select 1 from public.movimentos_clientes where cancelado_em is null group by cliente_id
        having sum(case when tipo='notinha' then valor else -valor end) < 0) then
        raise exception 'A recuperação deixaria um cliente com saldo negativo. Confira se o backup contém todas as notinhas.';
    end if;
    return jsonb_build_object('clientes_conta',n_clientes,'movimentos_clientes',n_movimentos,'total',n_clientes+n_movimentos);
end $$;
revoke all on function private.restaurar_contas_clientes_impl(jsonb) from public,anon;
grant execute on function private.restaurar_contas_clientes_impl(jsonb) to authenticated;

create function public.restaurar_contas_clientes(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_resultado jsonb;
begin
    if public.usuario_autorizado_atual() is distinct from true then raise exception 'Usuário não autorizado.' using errcode='42501'; end if;
    if p_dados is null or jsonb_typeof(p_dados) <> 'object' or not(p_dados ? 'clientes_conta' and p_dados ? 'movimentos_clientes') then raise exception 'Área de clientes do backup inválida.'; end if;
    perform pg_advisory_xact_lock(1747835,1);
    perform public.criar_backup_protegido('antes-restauracao-clientes');
    v_resultado := private.restaurar_contas_clientes_impl(p_dados);
    perform public.criar_backup_protegido('apos-restauracao-clientes');
    return v_resultado;
end $$;
revoke all on function public.restaurar_contas_clientes(jsonb) from public,anon;
grant execute on function public.restaurar_contas_clientes(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION private.criar_backup_protegido_impl(p_origem text, p_usuario_id uuid)
 RETURNS TABLE(id uuid, criado_em timestamp with time zone, hash_sha256 text, totais jsonb, conteudo jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_id uuid := gen_random_uuid();
  v_agora timestamptz := now();
  v_conteudo jsonb;
  v_totais jsonb;
  v_hash text;
  v_origem text := left(coalesce(nullif(btrim(p_origem),''), 'manual'), 40);
  v_uid uuid := auth.uid();
  v_claim_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_uid is not null then
    if p_usuario_id is distinct from v_uid
       or not exists(select 1 from public.usuarios_autorizados u where u.user_id = v_uid) then
      raise exception 'Usuário não autorizado para criar backup.';
    end if;
  elsif session_user <> 'postgres' and v_claim_role <> 'service_role' then
    raise exception 'Contexto não autorizado para criar backup.';
  end if;

  perform pg_advisory_xact_lock(1747835, 1);

  select jsonb_build_object(
    'clientes_conta', (select count(*) from public.clientes_conta),
    'movimentos_clientes', (select count(*) from public.movimentos_clientes),
    'funcionarios', (select count(*) from public.funcionarios),
    'produtos', (select count(*) from public.produtos),
    'consumos', (select count(*) from public.consumos),
    'faltas', (select count(*) from public.faltas),
    'historico_acoes', (select count(*) from public.historico_acoes),
    'lixeira_dados', (select count(*) from public.lixeira_dados),
    'auditoria_dados', (select count(*) from public.auditoria_dados)
  ) into v_totais;

  select jsonb_build_object(
    'sistema', 'XBurguer Controle',
    'formato', 'backup-supabase-protegido',
    'versao', 3,
    'exportado_em', v_agora,
    'dados', jsonb_build_object(
      'clientes_conta', coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em, x.id) from public.clientes_conta x), '[]'::jsonb),
      'movimentos_clientes', coalesce((select jsonb_agg(to_jsonb(x) order by x.data, x.criado_em, x.id) from public.movimentos_clientes x), '[]'::jsonb),
      'funcionarios', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.funcionarios x), '[]'::jsonb),
      'produtos', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.produtos x), '[]'::jsonb),
      'consumos', coalesce((select jsonb_agg(to_jsonb(x) order by x.data_hora, x.id) from public.consumos x), '[]'::jsonb),
      'faltas', coalesce((select jsonb_agg(to_jsonb(x) order by x.data, x.id) from public.faltas x), '[]'::jsonb),
      'historico_acoes', coalesce((select jsonb_agg(to_jsonb(x) order by x.data_hora, x.id) from public.historico_acoes x), '[]'::jsonb)
    ),
    'protecao', jsonb_build_object(
      'lixeira_dados', coalesce((select jsonb_agg(to_jsonb(x) order by x.excluido_em, x.id) from public.lixeira_dados x), '[]'::jsonb),
      'auditoria_dados', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.auditoria_dados x), '[]'::jsonb)
    ),
    'totais', v_totais
  ) into v_conteudo;

  v_hash := encode(extensions.digest(v_conteudo::text, 'sha256'), 'hex');

  insert into public.backups_internos(
    id, criado_em, origem, usuario_id, versao, totais, hash_sha256, conteudo
  )
  values (
    v_id, v_agora, v_origem, p_usuario_id, 3, v_totais, v_hash, v_conteudo
  );

  return query select v_id, v_agora, v_hash, v_totais, v_conteudo;
end;
$function$;
CREATE FUNCTION private.restaurar_backup_seguro_impl(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contas jsonb := '{}'::jsonb;
  n_func int := 0;
  n_prod int := 0;
  n_cons int := 0;
  n_falt int := 0;
  n_hist int := 0;
begin
  if not private.usuario_xburguer_autorizado() then
    raise exception 'Usuário não autorizado para restaurar backup.';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Área de dados do backup inválida.';
  end if;

  perform pg_advisory_xact_lock(1747835, 1);
  perform public.criar_backup_protegido('antes-restauracao');
  v_contas := private.restaurar_contas_clientes_impl(p_dados);

  insert into public.funcionarios(id,nome,cargo,salario,status,created_at,updated_at)
  select r.id, btrim(r.nome), btrim(r.cargo), r.salario,
         case when r.status='Inativo' then 'Inativo' else 'Ativo' end,
         coalesce(r.created_at, now()), coalesce(r.updated_at, r.created_at, now())
  from jsonb_to_recordset(coalesce(p_dados->'funcionarios','[]'::jsonb)) as r(
    id uuid,nome text,cargo text,salario numeric,status text,created_at timestamptz,updated_at timestamptz)
  where r.id is not null and nullif(btrim(r.nome),'') is not null and nullif(btrim(r.cargo),'') is not null
    and not exists (select 1 from public.funcionarios x where x.id=r.id);
  get diagnostics n_func = row_count;

  insert into public.produtos(id,nome,preco,ativo,created_at,updated_at)
  select r.id, btrim(r.nome), greatest(coalesce(r.preco,0),0), coalesce(r.ativo,true),
         coalesce(r.created_at, now()), coalesce(r.updated_at, r.created_at, now())
  from jsonb_to_recordset(coalesce(p_dados->'produtos','[]'::jsonb)) as r(
    id uuid,nome text,preco numeric,ativo boolean,created_at timestamptz,updated_at timestamptz)
  where r.id is not null and nullif(btrim(r.nome),'') is not null
    and not exists (select 1 from public.produtos x where x.id=r.id);
  get diagnostics n_prod = row_count;

  insert into public.consumos(id,funcionario_id,produto_id,tipo,descricao,observacao,quantidade,preco_unitario,data_hora,created_at)
  select r.id, r.funcionario_id,
         case when r.produto_id is not null and exists(select 1 from public.produtos p where p.id=r.produto_id) then r.produto_id else null end,
         case when r.tipo='avulso' then 'avulso' else 'produto' end,
         coalesce(nullif(btrim(r.descricao),''),'Sem descrição'), r.observacao,
         greatest(coalesce(r.quantidade,1),1), greatest(coalesce(r.preco_unitario,0),0),
         coalesce(r.data_hora, now()), coalesce(r.created_at, r.data_hora, now())
  from jsonb_to_recordset(coalesce(p_dados->'consumos','[]'::jsonb)) as r(
    id uuid,funcionario_id uuid,produto_id uuid,tipo text,descricao text,observacao text,quantidade int,preco_unitario numeric,data_hora timestamptz,created_at timestamptz)
  where r.id is not null
    and exists(select 1 from public.funcionarios f where f.id=r.funcionario_id)
    and not exists (select 1 from public.consumos x where x.id=r.id);
  get diagnostics n_cons = row_count;

  insert into public.faltas(id,funcionario_id,data,motivo,observacao,created_at,valor_desconto)
  select r.id, r.funcionario_id, r.data, coalesce(r.motivo,''), r.observacao,
         coalesce(r.created_at, now()), greatest(coalesce(r.valor_desconto,0),0)
  from jsonb_to_recordset(coalesce(p_dados->'faltas','[]'::jsonb)) as r(
    id uuid,funcionario_id uuid,data date,motivo text,observacao text,created_at timestamptz,valor_desconto numeric)
  where r.id is not null and r.data is not null
    and exists(select 1 from public.funcionarios f where f.id=r.funcionario_id)
    and not exists (select 1 from public.faltas x where x.id=r.id);
  get diagnostics n_falt = row_count;

  insert into public.historico_acoes(id,usuario_id,usuario_nome,acao,detalhes,icone,data_hora)
  select r.id,
         case when r.usuario_id is not null and exists(select 1 from auth.users u where u.id=r.usuario_id) then r.usuario_id else null end,
         coalesce(nullif(btrim(r.usuario_nome),''),'X-Burguer'),
         coalesce(nullif(btrim(r.acao),''),'Ação recuperada'), r.detalhes, coalesce(r.icone,'📝'), coalesce(r.data_hora,now())
  from jsonb_to_recordset(coalesce(p_dados->'historico_acoes','[]'::jsonb)) as r(
    id uuid,usuario_id uuid,usuario_nome text,acao text,detalhes text,icone text,data_hora timestamptz)
  where r.id is not null
    and not exists (select 1 from public.historico_acoes x where x.id=r.id);
  get diagnostics n_hist = row_count;

  perform public.criar_backup_protegido('apos-restauracao');
  return jsonb_build_object(
    'clientes_conta', coalesce((v_contas->>'clientes_conta')::int,0),
    'movimentos_clientes', coalesce((v_contas->>'movimentos_clientes')::int,0),
    'funcionarios', n_func,
    'produtos', n_prod,
    'consumos', n_cons,
    'faltas', n_falt,
    'historico_acoes', n_hist,
    'total', n_func+n_prod+n_cons+n_falt+n_hist+coalesce((v_contas->>'total')::int,0)
  );
end;
$function$;

revoke all on function private.restaurar_backup_seguro_impl(jsonb) from public, anon;
grant execute on function private.restaurar_backup_seguro_impl(jsonb) to authenticated, service_role;
create or replace function public.restaurar_backup_seguro(p_dados jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado para restaurar backup.' using errcode='42501';
    end if;
    return private.restaurar_backup_seguro_impl(p_dados);
end $$;


create trigger trg_clientes_auditoria after insert or update on public.clientes_conta
    for each row execute function private.proteger_dados_operacionais();
create trigger trg_movimentos_clientes_auditoria after insert or update on public.movimentos_clientes
    for each row execute function private.proteger_dados_operacionais();

-- Somente wrappers SECURITY INVOKER ficam expostos no schema public.
alter function public.salvar_cliente_conta(jsonb) set schema private;
alter function private.salvar_cliente_conta(jsonb) rename to salvar_cliente_conta_api_impl;
revoke all on function private.salvar_cliente_conta_api_impl(jsonb) from public, anon;
grant execute on function private.salvar_cliente_conta_api_impl(jsonb) to authenticated;
create function public.salvar_cliente_conta(p_dados jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
    if auth.uid() is null or public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return private.salvar_cliente_conta_api_impl(p_dados);
end $$;
revoke all on function public.salvar_cliente_conta(jsonb) from public, anon;
grant execute on function public.salvar_cliente_conta(jsonb) to authenticated;
alter function public.obter_contas_clientes() set schema private;
alter function private.obter_contas_clientes() rename to obter_contas_clientes_api_impl;
revoke all on function private.obter_contas_clientes_api_impl() from public, anon;
grant execute on function private.obter_contas_clientes_api_impl() to authenticated;
create function public.obter_contas_clientes() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
    if auth.uid() is null or public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return private.obter_contas_clientes_api_impl();
end $$;
revoke all on function public.obter_contas_clientes() from public, anon;
grant execute on function public.obter_contas_clientes() to authenticated;
alter function public.registrar_movimento_cliente(jsonb) set schema private;
alter function private.registrar_movimento_cliente(jsonb) rename to registrar_movimento_cliente_api_impl;
revoke all on function private.registrar_movimento_cliente_api_impl(jsonb) from public, anon;
grant execute on function private.registrar_movimento_cliente_api_impl(jsonb) to authenticated;
create function public.registrar_movimento_cliente(p_dados jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
    if auth.uid() is null or public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return private.registrar_movimento_cliente_api_impl(p_dados);
end $$;
revoke all on function public.registrar_movimento_cliente(jsonb) from public, anon;
grant execute on function public.registrar_movimento_cliente(jsonb) to authenticated;
alter function public.cancelar_movimento_cliente(uuid,text) set schema private;
alter function private.cancelar_movimento_cliente(uuid,text) rename to cancelar_movimento_cliente_api_impl;
revoke all on function private.cancelar_movimento_cliente_api_impl(uuid,text) from public, anon;
grant execute on function private.cancelar_movimento_cliente_api_impl(uuid,text) to authenticated;
create function public.cancelar_movimento_cliente(p_id uuid, p_motivo text) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
    if auth.uid() is null or public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return private.cancelar_movimento_cliente_api_impl(p_id, p_motivo);
end $$;
revoke all on function public.cancelar_movimento_cliente(uuid,text) from public, anon;
grant execute on function public.cancelar_movimento_cliente(uuid,text) to authenticated;
alter function public.restaurar_contas_clientes(jsonb) set schema private;
alter function private.restaurar_contas_clientes(jsonb) rename to restaurar_contas_clientes_api_impl;
revoke all on function private.restaurar_contas_clientes_api_impl(jsonb) from public, anon;
grant execute on function private.restaurar_contas_clientes_api_impl(jsonb) to authenticated;
create function public.restaurar_contas_clientes(p_dados jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
    if auth.uid() is null or public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return private.restaurar_contas_clientes_api_impl(p_dados);
end $$;
revoke all on function public.restaurar_contas_clientes(jsonb) from public, anon;
grant execute on function public.restaurar_contas_clientes(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Somente fixtures em banco descartável. Definições lidas em 17/10/2026.
CREATE OR REPLACE FUNCTION public.criar_backup_protegido(p_origem text DEFAULT 'manual'::text)
 RETURNS TABLE(id uuid, criado_em timestamp with time zone, hash_sha256 text, totais jsonb, conteudo jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_claim_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_uid is not null then
    if not private.usuario_xburguer_autorizado() then
      raise exception 'Usuário não autorizado para criar backup.';
    end if;
  elsif session_user <> 'postgres' and v_claim_role <> 'service_role' then
    raise exception 'Contexto não autorizado para criar backup.';
  end if;

  return query
  select *
  from private.criar_backup_protegido_impl(p_origem, v_uid);
end;
$function$;
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

  select jsonb_build_object(
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
CREATE OR REPLACE FUNCTION private.proteger_dados_operacionais()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'private', 'pg_temp'
AS $function$
declare
  v_registro_id uuid;
begin
  if tg_op = 'DELETE' then
    v_registro_id := (to_jsonb(old)->>'id')::uuid;

    insert into public.lixeira_dados(tabela, registro_id, dados, usuario_id)
    values (tg_table_name, v_registro_id, to_jsonb(old), auth.uid());

    insert into public.auditoria_dados(tabela, operacao, registro_id, antes, depois, usuario_id)
    values (tg_table_name, 'DELETE', v_registro_id, to_jsonb(old), null, auth.uid());

    return old;
  elsif tg_op = 'UPDATE' then
    v_registro_id := (to_jsonb(new)->>'id')::uuid;
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into public.auditoria_dados(tabela, operacao, registro_id, antes, depois, usuario_id)
      values (tg_table_name, 'UPDATE', v_registro_id, to_jsonb(old), to_jsonb(new), auth.uid());
    end if;
    return new;
  else
    v_registro_id := (to_jsonb(new)->>'id')::uuid;
    insert into public.auditoria_dados(tabela, operacao, registro_id, antes, depois, usuario_id)
    values (tg_table_name, 'INSERT', v_registro_id, null, to_jsonb(new), auth.uid());
    return new;
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.restaurar_backup_seguro(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'private', 'pg_temp'
AS $function$
declare
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

  return jsonb_build_object(
    'funcionarios', n_func,
    'produtos', n_prod,
    'consumos', n_cons,
    'faltas', n_falt,
    'historico_acoes', n_hist,
    'total', n_func+n_prod+n_cons+n_falt+n_hist
  );
end;
$function$;
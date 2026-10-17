-- SOMENTE banco temporário de testes. Este arquivo não pertence à migration de produção.
do $$ begin
    if to_regnamespace('auth') is not null or to_regclass('public.clientes_conta') is not null then
        raise exception 'Use um banco vazio e descartável para estes testes.';
    end if;
end $$;
set xburguer.testes_clientes = 'ativo';
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
create schema extensions;
create table auth.users(id uuid primary key);
insert into auth.users values ('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema private to authenticated, service_role;
create function public.usuario_autorizado_atual() returns boolean language sql stable security definer as $$
    select coalesce(auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid, false)
$$;
create table public.usuarios_autorizados(user_id uuid primary key);
insert into public.usuarios_autorizados values ('11111111-1111-1111-1111-111111111111');
create function private.usuario_xburguer_autorizado() returns boolean language sql stable security definer as $$ select public.usuario_autorizado_atual() $$;
create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;
create table public.funcionarios(id uuid primary key,nome text,cargo text,salario numeric,status text,created_at timestamptz,updated_at timestamptz);
create table public.produtos(id uuid primary key,nome text,preco numeric,ativo boolean,created_at timestamptz,updated_at timestamptz);
create table public.consumos(id uuid primary key,funcionario_id uuid,produto_id uuid,tipo text,descricao text,observacao text,quantidade int,preco_unitario numeric,data_hora timestamptz,created_at timestamptz);
create table public.faltas(id uuid primary key,funcionario_id uuid,data date,motivo text,observacao text,created_at timestamptz,valor_desconto numeric);
create table public.historico_acoes(id uuid primary key,usuario_id uuid,usuario_nome text,acao text,detalhes text,icone text,data_hora timestamptz);
create table public.auditoria_dados(id bigint generated always as identity primary key,tabela text not null,operacao text not null,registro_id uuid,antes jsonb,depois jsonb,usuario_id uuid,data_hora timestamptz not null default now());
create table public.lixeira_dados(id uuid primary key default gen_random_uuid(),tabela text,registro_id uuid,dados jsonb,usuario_id uuid,excluido_em timestamptz default now());
create table public.backups_internos(id uuid primary key,criado_em timestamptz,origem text,usuario_id uuid,versao int,totais jsonb,hash_sha256 text,conteudo jsonb);
grant select,insert on public.funcionarios, public.produtos, public.consumos, public.faltas, public.historico_acoes to authenticated;
alter table public.backups_internos enable row level security;
grant select on public.backups_internos to authenticated;
grant select on public.auditoria_dados to authenticated;
alter table public.auditoria_dados enable row level security;
create policy auditoria_leitura on public.auditoria_dados for select to authenticated using(public.usuario_autorizado_atual());
create policy backups_leitura on public.backups_internos for select to authenticated using(public.usuario_autorizado_atual());
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

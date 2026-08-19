-- X-Burguer - Etapa 10
-- Ajuste final de privilégios mínimos para o usuário autenticado do site.
-- Execute no Supabase > SQL Editor.

-- Mantém o RLS habilitado.
alter table public.funcionarios enable row level security;
alter table public.produtos enable row level security;
alter table public.consumos enable row level security;
alter table public.faltas enable row level security;
alter table public.historico_acoes enable row level security;

-- Remove privilégios extras e devolve somente o que cada tela realmente usa.
revoke all privileges on table public.funcionarios from authenticated;
revoke all privileges on table public.produtos from authenticated;
revoke all privileges on table public.consumos from authenticated;
revoke all privileges on table public.faltas from authenticated;
revoke all privileges on table public.historico_acoes from authenticated;

grant select, insert, update, delete
on table public.funcionarios
to authenticated;

grant select, insert, update, delete
on table public.produtos
to authenticated;

-- Consumos e faltas não possuem edição no sistema atual.
grant select, insert, delete
on table public.consumos
to authenticated;

grant select, insert, delete
on table public.faltas
to authenticated;

-- Histórico é somente leitura + inclusão.
grant select, insert
on table public.historico_acoes
to authenticated;

-- O projeto usa UUIDs e não depende de sequences para essas tabelas.
revoke all privileges on all sequences in schema public from authenticated;

-- Fortalece a função de updated_at contra alteração indevida de search_path.
alter function public.atualizar_updated_at()
set search_path = public, pg_temp;

-- Verificação dos privilégios finais.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (
    'funcionarios',
    'produtos',
    'consumos',
    'faltas',
    'historico_acoes'
  )
group by grantee, table_name
order by table_name;

-- Verificação do RLS.
select
  c.relname as tabela,
  c.relrowsecurity as rls_ativo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'funcionarios',
    'produtos',
    'consumos',
    'faltas',
    'historico_acoes'
  )
order by c.relname;

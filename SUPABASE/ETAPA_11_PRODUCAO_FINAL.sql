-- X-Burguer - Etapa 11 / Produção
-- Execute no Supabase > SQL Editor antes de publicar o sistema.

-- 1) O visitante NÃO autenticado não deve acessar nenhuma tabela operacional.
revoke all privileges on table public.funcionarios from anon;
revoke all privileges on table public.produtos from anon;
revoke all privileges on table public.consumos from anon;
revoke all privileges on table public.faltas from anon;
revoke all privileges on table public.historico_acoes from anon;
revoke all privileges on all sequences in schema public from anon;

-- 2) Mantém os privilégios mínimos definidos na Etapa 10.
revoke all privileges on table public.funcionarios from authenticated;
revoke all privileges on table public.produtos from authenticated;
revoke all privileges on table public.consumos from authenticated;
revoke all privileges on table public.faltas from authenticated;
revoke all privileges on table public.historico_acoes from authenticated;

grant select, insert, update, delete on table public.funcionarios to authenticated;
grant select, insert, update, delete on table public.produtos to authenticated;
grant select, insert, delete on table public.consumos to authenticated;
grant select, insert, delete on table public.faltas to authenticated;
grant select, insert on table public.historico_acoes to authenticated;

-- 3) Remove políticas de UPDATE que o sistema não utiliza em consumos/faltas
-- e políticas de alteração/exclusão do histórico.
drop policy if exists "consumos_authenticated_update" on public.consumos;
drop policy if exists "faltas_authenticated_update" on public.faltas;
drop policy if exists "historico_authenticated_update" on public.historico_acoes;
drop policy if exists "historico_authenticated_delete" on public.historico_acoes;

-- 4) Histórico: somente o próprio usuário autenticado pode gravar uma ação em seu nome.
drop policy if exists "historico_authenticated_insert" on public.historico_acoes;
create policy "historico_authenticated_insert"
on public.historico_acoes
for insert
to authenticated
with check (usuario_id = auth.uid());

-- 5) RLS obrigatório nas cinco tabelas.
alter table public.funcionarios enable row level security;
alter table public.produtos enable row level security;
alter table public.consumos enable row level security;
alter table public.faltas enable row level security;
alter table public.historico_acoes enable row level security;

-- 6) Verificação de privilégios do usuário autenticado.
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

-- Para confirmar que anon não tem privilégios, execute separadamente:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and grantee = 'anon'
--   and table_name in ('funcionarios','produtos','consumos','faltas','historico_acoes');
-- O resultado esperado é 0 linhas.

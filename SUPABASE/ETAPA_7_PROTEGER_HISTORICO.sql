-- X-Burguer - Etapa 7
-- Torna o histórico de ações "append-only" para usuários do site:
-- podem consultar e inserir, mas não alterar nem apagar registros existentes.

alter table public.historico_acoes enable row level security;

drop policy if exists "historico_authenticated_insert" on public.historico_acoes;
drop policy if exists "historico_authenticated_update" on public.historico_acoes;
drop policy if exists "historico_authenticated_delete" on public.historico_acoes;

create policy "historico_authenticated_insert"
on public.historico_acoes
for insert
to authenticated
with check (usuario_id = auth.uid());

revoke update, delete on public.historico_acoes from authenticated;
grant select, insert on public.historico_acoes to authenticated;

-- Verificação: deve retornar SELECT e INSERT para authenticated.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'historico_acoes'
  and grantee = 'authenticated'
order by privilege_type;

-- SOMENTE banco temporário de testes. Este arquivo não pertence à migration de produção.
do $$ begin
    if to_regnamespace('auth') is not null or to_regclass('public.clientes_conta') is not null then
        raise exception 'Use um banco vazio e descartável para estes testes.';
    end if;
end $$;
set xburguer.testes_clientes = 'ativo';
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create function public.usuario_autorizado_atual() returns boolean language sql stable security definer as $$
    select coalesce(auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid, false)
$$;

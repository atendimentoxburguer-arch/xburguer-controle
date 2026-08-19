-- X-Burguer - Auditoria de contas autorizadas
-- Execute no SQL Editor quando quiser conferir quais contas existem no Auth.
select
  id,
  email,
  created_at,
  last_sign_in_at
from auth.users
order by created_at;

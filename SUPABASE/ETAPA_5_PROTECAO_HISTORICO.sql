-- X-Burguer - Etapa 5 - proteção do histórico
-- Execute uma vez no Supabase > SQL Editor antes de testar Consumos.
-- Objetivo: impedir que a exclusão de um funcionário apague consumos/faltas históricos.

alter table public.consumos
  drop constraint if exists consumos_funcionario_id_fkey;

alter table public.consumos
  add constraint consumos_funcionario_id_fkey
  foreign key (funcionario_id)
  references public.funcionarios(id)
  on delete restrict;

alter table public.faltas
  drop constraint if exists faltas_funcionario_id_fkey;

alter table public.faltas
  add constraint faltas_funcionario_id_fkey
  foreign key (funcionario_id)
  references public.funcionarios(id)
  on delete restrict;

-- Verificação rápida das duas regras:
select
  tc.table_name,
  tc.constraint_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.constraint_name in ('consumos_funcionario_id_fkey','faltas_funcionario_id_fkey')
order by tc.table_name;

-- Nova migration aditiva. Executar no projeto XBurguer Controle antes de publicar a interface.
-- Não executar novamente os arquivos históricos ETAPA_*.sql.
begin;

do $$ begin
    if to_regprocedure('public.usuario_autorizado_atual()') is null then
        raise exception 'A migration exige a autorização atual do Controle de Consumo.';
    end if;
end $$;

create table public.clientes_conta (
    id uuid primary key default gen_random_uuid(),
    nome text not null check (length(btrim(nome)) between 1 and 120),
    telefone text not null default '' check (length(telefone) <= 40),
    observacao text not null default '' check (length(observacao) <= 1000),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    criado_por uuid not null default auth.uid()
);

create table public.movimentos_clientes (
    id uuid primary key default gen_random_uuid(),
    cliente_id uuid not null references public.clientes_conta(id) on delete restrict,
    tipo text not null check (tipo in ('notinha', 'pagamento')),
    data date not null,
    valor numeric(12,2) not null check (valor > 0 and valor <= 99999999.99),
    mesa text not null default '' check (length(mesa) <= 40),
    observacao text not null default '' check (length(observacao) <= 1000),
    comanda_assinada boolean not null default false,
    forma_pagamento text not null default '' check (forma_pagamento in ('', 'Dinheiro', 'Pix', 'Cartão', 'Outro')),
    criado_em timestamptz not null default now(),
    criado_por uuid not null default auth.uid(),
    cancelado_em timestamptz,
    cancelado_por uuid,
    motivo_cancelamento text,
    check ((tipo = 'notinha' and forma_pagamento = '') or
           (tipo = 'pagamento' and mesa = '' and not comanda_assinada and forma_pagamento <> '')),
    check ((cancelado_em is null and cancelado_por is null and motivo_cancelamento is null) or
           (cancelado_em is not null and cancelado_por is not null and length(btrim(motivo_cancelamento)) between 1 and 500))
);
create index movimentos_clientes_extrato on public.movimentos_clientes(cliente_id, data, criado_em, id);

alter table public.clientes_conta enable row level security;
alter table public.movimentos_clientes enable row level security;
revoke all on public.clientes_conta, public.movimentos_clientes from anon, authenticated;
grant select on public.clientes_conta, public.movimentos_clientes to authenticated;
create policy clientes_conta_leitura on public.clientes_conta for select to authenticated
    using ((select public.usuario_autorizado_atual()));
create policy movimentos_clientes_leitura on public.movimentos_clientes for select to authenticated
    using ((select public.usuario_autorizado_atual()));

-- Um único snapshot: totais e extratos não sofrem o limite de 1.000 linhas da API.
create function public.obter_contas_clientes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'clientes', coalesce((select jsonb_agg(c order by c.nome, c.id) from public.clientes_conta c), '[]'::jsonb),
        'movimentos', coalesce((select jsonb_agg(m order by m.data, m.criado_em, m.id) from public.movimentos_clientes m), '[]'::jsonb)
    );
end $$;

create function public.salvar_cliente_conta(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := (p_dados->>'id')::uuid;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if v_id is null or p_dados->>'nome' is null or jsonb_typeof(p_dados->'ativo') is distinct from 'boolean' then
        raise exception 'Informe nome e situação do cliente.';
    end if;
    insert into public.clientes_conta (id, nome, telefone, observacao, ativo)
    values (v_id, btrim(p_dados->>'nome'), btrim(coalesce(p_dados->>'telefone', '')),
            btrim(coalesce(p_dados->>'observacao', '')), (p_dados->>'ativo')::boolean)
    on conflict (id) do update set nome = excluded.nome, telefone = excluded.telefone,
        observacao = excluded.observacao, ativo = excluded.ativo, atualizado_em = now();
    return v_id;
end $$;

create function public.registrar_movimento_cliente(p_dados jsonb) returns uuid
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
       v_data is null or v_data > (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'Confira o tipo, a data e o valor (até duas casas decimais).';
    end if;
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

create function public.cancelar_movimento_cliente(p_id uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mov public.movimentos_clientes%rowtype; v_saldo numeric;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if p_motivo is null or length(btrim(p_motivo)) not between 1 and 500 then
        raise exception 'Informe o motivo do cancelamento (até 500 caracteres).';
    end if;
    select * into v_mov from public.movimentos_clientes where id = p_id;
    if not found then raise exception 'Lançamento não encontrado.'; end if;
    perform 1 from public.clientes_conta where id = v_mov.cliente_id for update;
    select * into v_mov from public.movimentos_clientes where id = p_id for update;
    if v_mov.cancelado_em is not null then return p_id; end if;
    select coalesce(sum(case when tipo = 'notinha' then valor else -valor end), 0)
        into v_saldo from public.movimentos_clientes where cliente_id = v_mov.cliente_id and cancelado_em is null;
    if v_mov.tipo = 'notinha' and v_mov.valor > v_saldo then
        raise exception 'Esta notinha já tem valor recebido. Cancele primeiro o pagamento correspondente para corrigir o lançamento.';
    end if;
    update public.movimentos_clientes set cancelado_em = now(), cancelado_por = auth.uid(),
        motivo_cancelamento = btrim(p_motivo) where id = p_id;
    return p_id;
end $$;

revoke all on function public.obter_contas_clientes(), public.salvar_cliente_conta(jsonb),
    public.registrar_movimento_cliente(jsonb), public.cancelar_movimento_cliente(uuid, text) from public, anon;
grant execute on function public.obter_contas_clientes(), public.salvar_cliente_conta(jsonb),
    public.registrar_movimento_cliente(jsonb), public.cancelar_movimento_cliente(uuid, text) to authenticated;
commit;

-- Edição e exclusão auditável de notinhas, sem alterar as demais áreas.
begin;
create function private.alterar_notinha_cliente_impl(p_dados jsonb, p_excluir boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid;
    v_mov public.movimentos_clientes%rowtype;
    v_original jsonb;
    v_novo jsonb;
    v_valor numeric;
    v_data date;
    v_mesa text;
    v_obs text;
    v_assinada boolean;
    v_motivo text;
    v_saldo numeric;
begin
    if public.usuario_autorizado_atual() is distinct from true then
        raise exception 'Usuário não autorizado.' using errcode = '42501';
    end if;
    if jsonb_typeof(p_dados) is distinct from 'object' or
       jsonb_typeof(p_dados->'original') is distinct from 'object' or p_excluir is null then
        raise exception 'Confira os dados originais da notinha.';
    end if;
    v_id := (p_dados->>'id')::uuid;
    perform pg_advisory_xact_lock_shared(1747835, 1);
    select * into v_mov from public.movimentos_clientes where id = v_id;
    if not found then raise exception 'Notinha não encontrada.'; end if;
    -- Mesma ordem de bloqueios dos pagamentos, cancelamentos e recuperação de backup.
    perform 1 from public.clientes_conta where id = v_mov.cliente_id for update;
    select * into v_mov from public.movimentos_clientes where id = v_id for update;
    if v_mov.tipo <> 'notinha' or v_mov.cliente_id is distinct from (p_dados->>'cliente_id')::uuid then
        raise exception 'Selecione uma notinha deste cliente.';
    end if;
    v_original := jsonb_build_object('data',v_mov.data,'valor',v_mov.valor,'mesa',v_mov.mesa,
        'observacao',v_mov.observacao,'comanda_assinada',v_mov.comanda_assinada);
    if p_excluir then
        v_motivo := coalesce(nullif(btrim(p_dados->>'motivo'), ''), 'Exclusão solicitada pelo usuário.');
        if length(v_motivo) > 500 then raise exception 'O motivo deve ter até 500 caracteres.'; end if;
        if v_mov.cancelado_em is not null then return v_id; end if; -- Repetição após perda de resposta.
    else
        if v_mov.cancelado_em is not null then raise exception 'Esta notinha já foi excluída. Feche a janela para sincronizar o extrato.'; end if;
        v_valor := (p_dados->>'valor')::numeric;
        v_data := (p_dados->>'data')::date;
        v_mesa := btrim(coalesce(p_dados->>'mesa',''));
        v_obs := btrim(coalesce(p_dados->>'observacao',''));
        if jsonb_typeof(p_dados->'comanda_assinada') is distinct from 'boolean' then
            raise exception 'Confira a confirmação de assinatura em papel.';
        end if;
        v_assinada := (p_dados->>'comanda_assinada')::boolean;
        if v_valor is null or v_valor <= 0 or v_valor > 99999999.99 or v_valor <> round(v_valor,2) or
           v_data is null or v_data < date '1900-01-01' or v_data > (now() at time zone 'America/Sao_Paulo')::date or
           length(v_mesa)>40 or length(v_obs)>1000 then
            raise exception 'Confira a data, a mesa e o valor da notinha (até duas casas decimais).';
        end if;
        v_novo := jsonb_build_object('data',v_data,'valor',v_valor,'mesa',v_mesa,
            'observacao',v_obs,'comanda_assinada',v_assinada);
        if v_original = v_novo then return v_id; end if; -- Gravação já concluída, sem nova auditoria.
    end if;
    if v_original is distinct from p_dados->'original' then
        raise exception 'Esta notinha foi alterada em outra tela. Feche a janela para sincronizar o extrato e confira os dados antes de tentar novamente.' using errcode = '40001';
    end if;
    select coalesce(sum(case when tipo='notinha' then valor else -valor end),0)
        into v_saldo from public.movimentos_clientes
        where cliente_id=v_mov.cliente_id and cancelado_em is null;
    if v_saldo - v_mov.valor + (case when p_excluir then 0 else v_valor end) < 0 then
        raise exception 'Os pagamentos já recebidos ultrapassariam o total das notinhas. Confira os pagamentos antes de reduzir ou excluir esta notinha.';
    end if;
    if p_excluir then
        update public.movimentos_clientes set cancelado_em=clock_timestamp(), cancelado_por=auth.uid(),
            motivo_cancelamento=v_motivo where id=v_id;
    else
        update public.movimentos_clientes set data=v_data,valor=v_valor,mesa=v_mesa,
            observacao=v_obs,comanda_assinada=v_assinada where id=v_id;
    end if;
    -- O trigger existente preserva autor, horário e valores antes/depois de cada alteração.
    return v_id;
end $$;
revoke all on function private.alterar_notinha_cliente_impl(jsonb,boolean) from public,anon;
grant execute on function private.alterar_notinha_cliente_impl(jsonb,boolean) to authenticated;

create function public.editar_notinha_cliente(p_dados jsonb) returns uuid
language sql security invoker set search_path = '' as $$
    select private.alterar_notinha_cliente_impl(p_dados,false);
$$;
create function public.excluir_notinha_cliente(p_dados jsonb) returns uuid
language sql security invoker set search_path = '' as $$
    select private.alterar_notinha_cliente_impl(p_dados,true);
$$;
revoke all on function public.editar_notinha_cliente(jsonb),public.excluir_notinha_cliente(jsonb) from public,anon;
grant execute on function public.editar_notinha_cliente(jsonb),public.excluir_notinha_cliente(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

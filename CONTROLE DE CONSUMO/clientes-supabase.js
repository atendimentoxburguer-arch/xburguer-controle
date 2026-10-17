(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const M = window.ContasClientes;
    const h = M.escapar;
    let dados = { clientes: [], movimentos: [] };
    let selecionado = null;
    let pronto = false;
    let salvando = false;
    let versaoCarga = 0;
    let movimentoId = null;
    let clienteFormularioId = null;

    function hoje() {
        const d = new Date();
        return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(d);
    }
    const clienteAtual = () => dados.clientes.find(c => c.id === selecionado);
    const movimentosDoCliente = id => dados.movimentos.filter(m => m.cliente_id === id);
    function status(texto, erro = false) {
        $("status-clientes").textContent = texto;
        $("status-clientes").dataset.erro = String(erro);
    }
    function mensagemErro(erro) {
        if (["PGRST202", "42P01", "42883"].includes(erro?.code)) {
            return "A área de clientes ainda não foi habilitada no banco. É necessário aplicar a atualização de Clientes e Notinhas no Supabase.";
        }
        return erro?.message || "Não foi possível conectar ao banco. Verifique a conexão e tente novamente.";
    }
    async function rpc(nome, parametros) {
        if (!window.supabaseClient) throw new Error("Conexão com o banco indisponível. Atualize a página.");
        const { data, error } = await window.supabaseClient.rpc(nome, parametros);
        if (error) throw error;
        return data;
    }
    function atualizarBotoes() {
        ["novo-cliente", "backup-clientes"].forEach(id => $(id).disabled = !pronto || salvando);
        $("nova-notinha").disabled = !pronto || salvando || !clienteAtual()?.ativo;
        $("novo-pagamento").disabled = !pronto || salvando || M.resumo(movimentosDoCliente(selecionado)).saldo <= 0;
        $("imprimir-extrato").disabled = !pronto || salvando;
        document.querySelectorAll("[data-cliente], [data-editar], [data-cancelar]").forEach(b => b.disabled = !pronto || salvando);
    }
    async function carregar() {
        const carga = ++versaoCarga;
        try {
            if (!window.supabaseClient) throw new Error("Conexão com o banco indisponível. Atualize a página.");
            const { data, error } = await window.supabaseClient.auth.getSession();
            if (error) throw error;
            if (!data?.session) { location.replace("login.html"); return false; }
            const snapshot = await rpc("obter_contas_clientes");
            if (carga !== versaoCarga) return false;
            if (!Array.isArray(snapshot?.clientes) || !Array.isArray(snapshot?.movimentos)) throw new Error("O banco retornou dados de clientes incompletos.");
            dados = snapshot;
            pronto = true;
            renderizar();
            status("Dados atualizados. Os valores incluem todos os períodos e clientes ativos e inativos.");
            return true;
        } catch (erro) {
            if (carga !== versaoCarga) return false;
            pronto = false;
            atualizarBotoes();
            if (!dados.clientes.length) $("tabela-clientes").innerHTML = '<tr><td colspan="5" class="tabela-vazia">Não foi possível carregar os clientes. Clique em Atualizar para tentar novamente.</td></tr>';
            status(mensagemErro(erro), true);
            return false;
        }
    }
    window.recarregarContasClientes = carregar;

    function renderizar() {
        const total = M.resumo(dados.movimentos);
        $("resumo-saldo").textContent = M.moeda(total.saldo);
        $("resumo-pagamentos").textContent = M.moeda(total.pagamentos);
        $("resumo-pendentes").textContent = dados.clientes.filter(c => M.resumo(movimentosDoCliente(c.id)).saldo > 0).length;
        renderizarClientes();
        renderizarExtrato();
        atualizarBotoes();
    }
    function renderizarClientes() {
        const busca = $("busca-cliente").value.trim().toLocaleLowerCase("pt-BR");
        const situacao = $("situacao-cliente").value;
        const clientes = dados.clientes.filter(c => {
            const buscaOk = `${c.nome} ${c.telefone}`.toLocaleLowerCase("pt-BR").includes(busca);
            return buscaOk && (situacao === "todos" || (situacao === "ativos" ? c.ativo : !c.ativo)) &&
                (!$("somente-pendentes").checked || M.resumo(movimentosDoCliente(c.id)).saldo > 0);
        });
        $("tabela-clientes").innerHTML = clientes.map(c => {
            const r = M.resumo(movimentosDoCliente(c.id));
            return `<tr><td><strong>${h(c.nome)}</strong><span class="clientes-detalhe">${h(c.telefone || "Sem telefone")}</span>
                <span class="clientes-tag">${c.ativo ? "Ativo" : "Inativo"}</span></td>
                <td>${M.moeda(r.notinhas)}</td><td>${M.moeda(r.pagamentos)}</td>
                <td class="clientes-saldo">${M.moeda(r.saldo)}${r.saldo > 0 ? '<span class="clientes-detalhe clientes-tag clientes-pendente">Pendente</span>' : ''}</td>
                <td><div class="clientes-botoes-linha"><button type="button" class="clientes-btn" data-cliente="${h(c.id)}" aria-label="Abrir extrato de ${h(c.nome)}">Extrato</button>
                <button type="button" class="clientes-btn" data-editar="${h(c.id)}" aria-label="Editar cliente ${h(c.nome)}">Editar</button></div></td></tr>`;
        }).join("") || '<tr><td colspan="5" class="tabela-vazia">Nenhum cliente encontrado.</td></tr>';
        $("contador-clientes").textContent = `${clientes.length} cliente(s) encontrado(s)`;
        atualizarBotoes();
    }
    function obterExtrato() {
        const inicio = $("extrato-inicio").value;
        const fim = $("extrato-fim").value;
        if (inicio && fim && inicio > fim) throw new Error("A data inicial deve ser anterior ou igual à data final.");
        return M.extrato(movimentosDoCliente(selecionado), inicio, fim);
    }
    function periodo() {
        return `${$("extrato-inicio").value ? M.dataBR($("extrato-inicio").value) : "Início"} até ${$("extrato-fim").value ? M.dataBR($("extrato-fim").value) : "hoje"}`;
    }
    function descricao(m) {
        if (m.tipo === "pagamento") return `Pagamento · ${m.forma_pagamento}`;
        return `Notinha${m.mesa ? ` · Mesa ${m.mesa}` : ""}${m.comanda_assinada ? " · Assinada em papel" : " · Assinatura não confirmada"}`;
    }
    const dataCancelamento = m => new Date(m.cancelado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    function renderizarExtrato() {
        const c = clienteAtual();
        $("extrato-cliente").hidden = !c;
        if (!c) return;
        $("titulo-extrato").textContent = `Extrato · ${c.nome}`;
        $("detalhes-cliente").textContent = [c.telefone, c.observacao, !c.ativo ? "Cliente inativo" : ""].filter(Boolean).join(" · ");
        $("saldo-cliente").textContent = `Saldo atual a pagar: ${M.moeda(M.resumo(movimentosDoCliente(c.id)).saldo)}`;
        try {
            const e = obterExtrato();
            $("periodo-extrato").textContent = `${periodo()} · Saldo anterior: ${M.moeda(e.saldoAnterior)} · Saldo ao final: ${M.moeda(e.saldoFinal)}`;
            $("tabela-extrato").innerHTML = e.linhas.map(m => `<tr${m.cancelado_em ? ' class="clientes-cancelado"' : ''}>
                <td>${M.dataBR(m.data)}</td><td>${h(descricao(m))}${m.observacao ? `<span class="clientes-detalhe">${h(m.observacao)}</span>` : ''}
                ${m.cancelado_em ? `<span class="clientes-detalhe">Cancelado em ${dataCancelamento(m)}: ${h(m.motivo_cancelamento)}</span>` : ''}</td>
                <td>${m.tipo === "pagamento" ? "− " : ""}${M.moeda(M.valorCentavos(m.valor))}${m.cancelado_em ? ' (cancelado)' : ''}</td>
                <td>${M.moeda(m.saldo)}</td><td>${!m.cancelado_em ? `<button type="button" class="clientes-btn clientes-btn-perigo" data-cancelar="${h(m.id)}" aria-label="Cancelar ${h(m.tipo)} de ${M.dataBR(m.data)}">Cancelar</button>` : '—'}</td></tr>`).join("") ||
                '<tr><td colspan="5" class="tabela-vazia">Nenhum lançamento neste período.</td></tr>';
        } catch (erro) {
            $("periodo-extrato").textContent = erro.message;
            $("tabela-extrato").innerHTML = "";
        }
        atualizarBotoes();
    }
    function abrirCliente(id) {
        if (!pronto || salvando) return;
        const c = dados.clientes.find(x => x.id === id);
        clienteFormularioId = c?.id || crypto.randomUUID();
        $("form-cliente").reset();
        $("cliente-id").value = clienteFormularioId;
        $("cliente-nome").value = c?.nome || "";
        $("cliente-telefone").value = c?.telefone || "";
        $("cliente-observacao").value = c?.observacao || "";
        $("cliente-ativo").checked = c ? c.ativo : true;
        $("titulo-dialog-cliente").textContent = c ? "Editar cliente" : "Novo cliente";
        $("erro-cliente").textContent = "";
        $("dialog-cliente").showModal();
    }
    function abrirMovimento(tipo) {
        const c = clienteAtual();
        if (!pronto || salvando || !c || (tipo === "notinha" && !c.ativo)) return;
        $("form-movimento").reset();
        movimentoId = crypto.randomUUID();
        $("movimento-tipo").value = tipo;
        $("movimento-data").value = hoje();
        $("movimento-data").max = hoje();
        $("movimento-cliente").textContent = `${c.nome} · Saldo a pagar: ${M.moeda(M.resumo(movimentosDoCliente(c.id)).saldo)}`;
        $("titulo-dialog-movimento").textContent = tipo === "notinha" ? "Nova notinha" : "Registrar pagamento";
        $("campo-mesa").hidden = tipo !== "notinha";
        $("campo-assinatura").hidden = tipo !== "notinha";
        $("campo-forma").hidden = tipo !== "pagamento";
        $("erro-movimento").textContent = "";
        $("dialog-movimento").showModal();
    }
    async function salvar(form, erroId, dialogId, operacao, mensagem) {
        if (salvando || !pronto) return;
        salvando = true;
        $(erroId).textContent = "";
        form.querySelectorAll("button").forEach(b => b.disabled = true);
        atualizarBotoes();
        try {
            await operacao();
            $(dialogId).close();
            const atualizado = await carregar();
            status(atualizado ? mensagem : `${mensagem} Não foi possível atualizar a tela. Clique em Atualizar.`, !atualizado);
        } catch (erro) {
            $(erroId).textContent = mensagemErro(erro);
        } finally {
            salvando = false;
            form.querySelectorAll("button").forEach(b => b.disabled = false);
            atualizarBotoes();
        }
    }
    async function registrarHistorico(acao, detalhes) {
        // O próprio lançamento guarda autor e datas no banco. Falha de histórico não desfaz o recebimento.
        try { await window.registrarNoHistorico?.(acao, detalhes, "🧾"); } catch (_) { /* Fila do histórico é independente. */ }
    }
    async function salvarCliente(evento) {
        evento.preventDefault();
        if (!$("cliente-nome").value.trim()) { $("erro-cliente").textContent = "Informe o nome do cliente."; return; }
        const payload = { id: clienteFormularioId, nome: $("cliente-nome").value.trim(), telefone: $("cliente-telefone").value.trim(),
            observacao: $("cliente-observacao").value.trim(), ativo: $("cliente-ativo").checked };
        await salvar(evento.target, "erro-cliente", "dialog-cliente", async () => {
            await rpc("salvar_cliente_conta", { p_dados: payload });
            selecionado = payload.id;
            await registrarHistorico("Salvou cadastro de cliente", payload.nome);
        }, "Cliente salvo.");
    }
    async function salvarMovimento(evento) {
        evento.preventDefault();
        let valor;
        try {
            valor = M.centavos($("movimento-valor").value);
            if (!$("movimento-data").value || $("movimento-data").value > hoje()) throw new Error("Informe uma data válida, até hoje.");
            if ($("movimento-tipo").value === "pagamento" && valor > M.resumo(movimentosDoCliente(selecionado)).saldo) throw new Error("O pagamento não pode ultrapassar o saldo a pagar.");
        } catch (erro) { $("erro-movimento").textContent = erro.message; return; }
        const tipo = $("movimento-tipo").value;
        const payload = { id: movimentoId, cliente_id: selecionado, tipo, data: $("movimento-data").value, valor: valor / 100,
            mesa: tipo === "notinha" ? $("movimento-mesa").value.trim() : "", observacao: $("movimento-observacao").value.trim(),
            comanda_assinada: tipo === "notinha" && $("movimento-assinada").checked, forma_pagamento: tipo === "pagamento" ? $("movimento-forma").value : "" };
        await salvar(evento.target, "erro-movimento", "dialog-movimento", async () => {
            await rpc("registrar_movimento_cliente", { p_dados: payload });
            await registrarHistorico(tipo === "notinha" ? "Registrou notinha de cliente" : "Recebeu pagamento de cliente", `${clienteAtual().nome} · ${M.moeda(valor)} · ${payload.id}`);
        }, tipo === "notinha" ? "Notinha registrada." : "Pagamento registrado e abatido do saldo.");
    }
    function abrirCancelamento(id) {
        if (!pronto || salvando) return;
        const m = movimentosDoCliente(selecionado).find(x => x.id === id);
        if (!m || m.cancelado_em) return;
        $("form-cancelamento").reset();
        $("cancelamento-id").value = id;
        $("cancelamento-resumo").textContent = `${clienteAtual().nome} · ${descricao(m)} · ${M.dataBR(m.data)} · ${M.moeda(M.valorCentavos(m.valor))}`;
        $("erro-cancelamento").textContent = "";
        $("dialog-cancelamento").showModal();
    }
    async function cancelarMovimento(evento) {
        evento.preventDefault();
        const motivo = $("cancelamento-motivo").value.trim();
        if (!motivo) { $("erro-cancelamento").textContent = "Informe o motivo do cancelamento."; return; }
        const id = $("cancelamento-id").value;
        await salvar(evento.target, "erro-cancelamento", "dialog-cancelamento", async () => {
            await rpc("cancelar_movimento_cliente", { p_id: id, p_motivo: motivo });
            await registrarHistorico("Cancelou lançamento de cliente", `${clienteAtual().nome} · ${id} · ${motivo}`);
        }, "Lançamento cancelado. O histórico foi preservado.");
    }
    function imprimir() {
        if (!pronto || !clienteAtual()) return;
        try {
            const c = clienteAtual();
            const e = obterExtrato();
            $("impressao-clientes").innerHTML = `<h1>X-Burguer · Extrato do cliente</h1><p><strong>${h(c.nome)}</strong>${c.telefone ? ` · ${h(c.telefone)}` : ''}</p>
                <p>Período: ${h(periodo())}</p><p>Saldo anterior: ${M.moeda(e.saldoAnterior)}</p>
                <table><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Saldo</th></tr></thead><tbody>${e.linhas.map(m =>
                `<tr><td>${M.dataBR(m.data)}</td><td>${h(descricao(m))}${m.observacao ? `<br>${h(m.observacao)}` : ''}${m.cancelado_em ? `<br>Cancelado: ${h(m.motivo_cancelamento)}` : ''}</td>
                <td>${m.tipo === "pagamento" ? "− " : ""}${M.moeda(M.valorCentavos(m.valor))}${m.cancelado_em ? ' (cancelado)' : ''}</td><td>${M.moeda(m.saldo)}</td></tr>`).join("")}</tbody></table>
                <p>Notinhas do período: ${M.moeda(e.totais.notinhas)} · Pagamentos do período: ${M.moeda(e.totais.pagamentos)}</p>
                <p><strong>Saldo ao final do período: ${M.moeda(e.saldoFinal)}</strong></p><p>Saldo atual de todos os períodos: ${M.moeda(M.resumo(movimentosDoCliente(c.id)).saldo)}</p>
                <p>Emitido em ${h(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}.</p><div class="assinatura">Assinatura do cliente</div>`;
            window.print();
        } catch (erro) { status(erro.message, true); }
    }
    async function baixarBackup() {
        if (salvando || !pronto) return;
        $("backup-clientes").disabled = true;
        if (!await carregar()) return;
        const pacote = { sistema: "xburguer-controle-clientes", versao: 1, exportado_em: new Date().toISOString(), dados };
        const url = URL.createObjectURL(new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `XBurguer-clientes-${hoje()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("Backup de clientes baixado, incluindo notinhas, pagamentos e cancelamentos. Guarde uma cópia em local seguro.");
    }
    window.addEventListener("DOMContentLoaded", () => {
        $("novo-cliente").addEventListener("click", () => abrirCliente());
        $("atualizar-clientes").addEventListener("click", () => { if (!salvando) carregar(); });
        $("backup-clientes").addEventListener("click", baixarBackup);
        ["busca-cliente", "situacao-cliente", "somente-pendentes"].forEach(id => $(id).addEventListener("input", renderizarClientes));
        ["extrato-inicio", "extrato-fim"].forEach(id => $(id).addEventListener("change", renderizarExtrato));
        $("limpar-periodo").addEventListener("click", () => { $("extrato-inicio").value = ""; $("extrato-fim").value = ""; renderizarExtrato(); });
        $("nova-notinha").addEventListener("click", () => abrirMovimento("notinha"));
        $("novo-pagamento").addEventListener("click", () => abrirMovimento("pagamento"));
        $("imprimir-extrato").addEventListener("click", imprimir);
        $("form-cliente").addEventListener("submit", salvarCliente);
        $("form-movimento").addEventListener("submit", salvarMovimento);
        $("form-cancelamento").addEventListener("submit", cancelarMovimento);
        document.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => { if (!salvando) $(b.dataset.fechar).close(); }));
        document.querySelectorAll("dialog").forEach(d => d.addEventListener("cancel", evento => { if (salvando) evento.preventDefault(); }));
        $("tabela-clientes").addEventListener("click", evento => {
            const b = evento.target.closest("button");
            if (!b || !pronto || salvando) return;
            if (b.dataset.editar) abrirCliente(b.dataset.editar);
            if (b.dataset.cliente) {
                selecionado = b.dataset.cliente;
                $("extrato-inicio").value = ""; $("extrato-fim").value = "";
                renderizarExtrato();
                $("titulo-extrato").focus();
            }
        });
        $("tabela-extrato").addEventListener("click", evento => {
            const b = evento.target.closest("[data-cancelar]");
            if (b) abrirCancelamento(b.dataset.cancelar);
        });
        carregar();
    });
})();

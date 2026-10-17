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
    let clienteFormularioRevisao = null;
    let paginaClientes = 1;
    let paginaExtrato = 1;
    let indice = M.indexar([]);
    let backupSelecionado = null;
    let analisandoBackup = false;
    let versaoArquivo = 0;

    function hoje() {
        const d = new Date();
        return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(d);
    }
    const clienteAtual = () => dados.clientes.find(c => c.id === selecionado);
    const movimentosDoCliente = id => indice.porCliente.get(id) || [];
    const resumoDoCliente = id => indice.totais.get(id) || { notinhas: 0, pagamentos: 0, saldo: 0 };
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
        ["novo-cliente", "backup-clientes", "recuperar-clientes"].forEach(id => $(id).disabled = !pronto || salvando);
        $("nova-notinha").disabled = !pronto || salvando || !clienteAtual()?.ativo;
        $("novo-pagamento").disabled = !pronto || salvando || resumoDoCliente(selecionado).saldo <= 0;
        $("imprimir-extrato").disabled = !pronto || salvando;
        $("copiar-extrato").disabled = !pronto || salvando;
        document.querySelectorAll(".clientes-form button[type=submit]").forEach(b => b.disabled = !pronto || salvando || (b.id === "confirmar-recuperacao-clientes" && (!backupSelecionado || analisandoBackup)));
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
            if (snapshot.versao !== 2) throw new Error("Aplique a atualização de melhorias de Clientes e Notinhas no Supabase antes de usar esta versão.");
            dados = snapshot;
            indice = M.indexar(dados.movimentos);
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
        $("resumo-pendentes").textContent = dados.clientes.filter(c => resumoDoCliente(c.id).saldo > 0).length;
        renderizarClientes();
        renderizarExtrato();
        atualizarBotoes();
    }
    function renderizarClientes() {
        const busca = M.normalizar($("busca-cliente").value);
        const situacao = $("situacao-cliente").value;
        const clientes = dados.clientes.filter(c => {
            const digitos = busca.replace(/\D/g, "");
            const buscaOk = M.normalizar(`${c.nome} ${c.telefone}`).includes(busca) ||
                (digitos.length > 0 && /^[\d\s()+-]+$/.test(busca) && c.telefone.replace(/\D/g, "").includes(digitos));
            return buscaOk && (situacao === "todos" || (situacao === "ativos" ? c.ativo : !c.ativo)) &&
                (!$("somente-pendentes").checked || resumoDoCliente(c.id).saldo > 0);
        });
        const p = M.paginar(clientes, paginaClientes, 25);
        paginaClientes = p.pagina;
        $("clientes-pagina").textContent = `Página ${p.pagina} de ${p.paginas}`;
        $("clientes-anterior").disabled = p.pagina === 1;
        $("clientes-proxima").disabled = p.pagina === p.paginas;
        $("tabela-clientes").innerHTML = p.itens.map(c => {
            const r = resumoDoCliente(c.id);
            const iniciais = c.nome.trim().split(/\s+/).slice(0, 2).map(nome => Array.from(nome)[0] || "").join("").toLocaleUpperCase("pt-BR");
            return `<tr${selecionado === c.id ? ' class="cliente-selecionado"' : ''}><td><div class="cliente-identidade"><span class="cliente-avatar" aria-hidden="true">${h(iniciais)}</span><div><strong>${h(c.nome)}</strong><span class="clientes-detalhe">${h(c.telefone || "Sem telefone")}</span>
                <span class="clientes-tag cliente-status">${c.ativo ? "Ativo" : "Inativo"}</span></div></div></td>
                <td data-label="Notinhas">${M.moeda(r.notinhas)}</td><td data-label="Recebido">${M.moeda(r.pagamentos)}</td>
                <td data-label="A receber" class="clientes-saldo">${M.moeda(r.saldo)}${r.saldo > 0 ? '<span class="clientes-detalhe clientes-tag clientes-pendente">Pendente</span>' : '<span class="clientes-detalhe clientes-tag clientes-em-dia">Em dia</span>'}</td>
                <td><div class="clientes-botoes-linha"><button type="button" class="clientes-btn btn-config-secundario" data-cliente="${h(c.id)}" aria-controls="extrato-cliente" aria-expanded="${selecionado === c.id}" aria-label="Abrir extrato de ${h(c.nome)}">Ver extrato</button>
                <button type="button" class="clientes-btn btn-config-secundario" data-editar="${h(c.id)}" aria-label="Editar cliente ${h(c.nome)}">Editar</button></div></td></tr>`;
        }).join("") || `<tr><td colspan="5" class="tabela-vazia"><div class="clientes-vazio"><strong>${dados.clientes.length ? "Nenhum cliente encontrado." : "Sua primeira conta começa aqui."}</strong><span>${dados.clientes.length ? "Tente outro nome ou ajuste os filtros da busca." : "Clique em Novo cliente para começar a organizar suas notinhas."}</span></div></td></tr>`;
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
        $("saldo-cliente").textContent = M.moeda(resumoDoCliente(c.id).saldo);
        try {
            const e = obterExtrato();
            const p = M.paginar(e.linhas, paginaExtrato, 50);
            paginaExtrato = p.pagina;
            $("extrato-pagina").textContent = `Página ${p.pagina} de ${p.paginas} · ${p.total} lançamento(s)`;
            $("extrato-anterior").disabled = p.pagina === 1;
            $("extrato-proxima").disabled = p.pagina === p.paginas;
            $("periodo-extrato").textContent = `${periodo()} · Saldo anterior: ${M.moeda(e.saldoAnterior)} · Saldo ao final: ${M.moeda(e.saldoFinal)}`;
            $("tabela-extrato").innerHTML = p.itens.map(m => `<tr${m.cancelado_em ? ' class="clientes-cancelado"' : ''}>
                <td>${M.dataBR(m.data)}</td><td><span class="clientes-tipo clientes-tipo-${m.tipo === "pagamento" ? "pagamento" : "notinha"}">${m.tipo === "pagamento" ? "PAGAMENTO" : "NOTINHA"}</span><span class="clientes-descricao">${h(descricao(m))}</span>${m.observacao ? `<span class="clientes-detalhe">${h(m.observacao)}</span>` : ''}
                ${m.cancelado_em ? `<span class="clientes-detalhe">Cancelado em ${dataCancelamento(m)}: ${h(m.motivo_cancelamento)}</span>` : ''}</td>
                <td${m.tipo === "pagamento" && !m.cancelado_em ? ' class="clientes-valor-pagamento"' : ''}>${m.tipo === "pagamento" ? "− " : ""}${M.moeda(M.valorCentavos(m.valor))}${m.cancelado_em ? ' (cancelado)' : ''}</td>
                <td>${M.moeda(m.saldo)}</td><td>${!m.cancelado_em ? `<button type="button" class="clientes-btn clientes-btn-perigo btn-config-secundario" data-cancelar="${h(m.id)}" aria-label="Cancelar ${h(m.tipo)} de ${M.dataBR(m.data)}">Cancelar</button>` : '—'}</td></tr>`).join("") ||
                '<tr><td colspan="5" class="tabela-vazia">Nenhum lançamento neste período.</td></tr>';
        } catch (erro) {
            $("periodo-extrato").textContent = erro.message;
            $("tabela-extrato").innerHTML = "";
            $("extrato-pagina").textContent = "Período inválido";
            $("extrato-anterior").disabled = true;
            $("extrato-proxima").disabled = true;
        }
        $("impressao-clientes").replaceChildren();
        atualizarBotoes();
    }
    function abrirCliente(id) {
        if (!pronto || salvando) return;
        const c = dados.clientes.find(x => x.id === id);
        clienteFormularioId = c?.id || crypto.randomUUID();
        clienteFormularioRevisao = c?.revisao ?? null;
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
        $("movimento-cliente").textContent = `${c.nome} · Saldo a pagar: ${M.moeda(resumoDoCliente(c.id).saldo)}`;
        $("titulo-dialog-movimento").textContent = tipo === "notinha" ? "Nova notinha" : "Registrar pagamento";
        $("campo-mesa").hidden = tipo !== "notinha";
        $("campo-assinatura").hidden = tipo !== "notinha";
        $("campo-forma").hidden = tipo !== "pagamento";
        $("erro-movimento").textContent = "";
        $("dialog-movimento").showModal();
    }
    async function salvar(form, erroId, dialogId, operacao, mensagem) {
        if (salvando) return;
        if (!pronto || !navigator.onLine) { $(erroId).textContent = "Atualize a conexão e os dados antes de salvar."; return; }
        salvando = true;
        $(erroId).textContent = "";
        form.querySelectorAll("button,input,select,textarea").forEach(b => b.disabled = true);
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
            form.querySelectorAll("button,input,select,textarea").forEach(b => b.disabled = false);
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
            observacao: $("cliente-observacao").value.trim(), ativo: $("cliente-ativo").checked, revisao: clienteFormularioRevisao };
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
            if (!$("movimento-data").value || $("movimento-data").value < "1900-01-01" || $("movimento-data").value > hoje()) throw new Error("Informe uma data válida, de 1900 até hoje.");
            if ($("movimento-tipo").value === "pagamento" && valor > resumoDoCliente(selecionado).saldo) throw new Error("O pagamento não pode ultrapassar o saldo a pagar.");
        } catch (erro) { $("erro-movimento").textContent = erro.message; return; }
        const tipo = $("movimento-tipo").value;
        const payload = { id: movimentoId, cliente_id: selecionado, tipo, data: $("movimento-data").value, valor: valor / 100,
            mesa: tipo === "notinha" ? $("movimento-mesa").value.trim() : "", observacao: $("movimento-observacao").value.trim(),
            comanda_assinada: tipo === "notinha" && $("movimento-assinada").checked, forma_pagamento: tipo === "pagamento" ? $("movimento-forma").value : "" };
        await salvar(evento.target, "erro-movimento", "dialog-movimento", async () => {
            try {
                await rpc("registrar_movimento_cliente", { p_dados: payload });
            } catch (erro) {
                // Se apenas a resposta se perdeu, reconhecer o ID já gravado evita nova cobrança.
                let reconhecido = false;
                if (!erro.code || erro.code === "FETCH_ERROR") {
                    try {
                        const snapshot = await rpc("obter_contas_clientes");
                        reconhecido = snapshot?.movimentos?.some(m => m.id === payload.id && m.cliente_id === payload.cliente_id && M.valorCentavos(m.valor) === valor && m.tipo === tipo);
                    } catch (_) { /* A próxima tentativa mantém o mesmo ID. */ }
                }
                if (!reconhecido) throw erro;
            }
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
    function montarImpressao() {
        if (!pronto || !clienteAtual()) {
            $("impressao-clientes").textContent = "Abra o extrato de um cliente com os dados atualizados para imprimir.";
            return false;
        }
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
            return true;
        } catch (erro) { $("impressao-clientes").textContent = erro.message; status(erro.message, true); return false; }
    }
    function imprimir() { if (montarImpressao()) window.print(); }
    async function copiarResumo() {
        if (!pronto || !clienteAtual()) return;
        try {
            const e = obterExtrato();
            const texto = ["X-Burguer · Resumo da conta", `Cliente: ${clienteAtual().nome}`, `Período: ${periodo()}`,
                `Saldo anterior: ${M.moeda(e.saldoAnterior)}`, `Notinhas do período: ${M.moeda(e.totais.notinhas)}`,
                `Pagamentos do período: ${M.moeda(e.totais.pagamentos)}`, `Saldo ao final do período: ${M.moeda(e.saldoFinal)}`,
                `Saldo atual a pagar: ${M.moeda(resumoDoCliente(selecionado).saldo)}`].join("\n");
            await navigator.clipboard.writeText(texto);
            status("Resumo copiado. Você pode colar na conversa com o cliente.");
        } catch (erro) { status(erro?.message || "Não foi possível copiar. Use Imprimir / PDF para gerar o extrato.", true); }
    }
    async function baixarBackup() {
        if (salvando || !pronto) return;
        salvando = true; atualizarBotoes();
        try {
            const resposta = await rpc("criar_backup_protegido", { p_origem: "clientes-download" });
            const registro = Array.isArray(resposta) ? resposta[0] : resposta;
            const d = registro?.conteudo?.dados;
            if (!Array.isArray(d?.clientes_conta) || !Array.isArray(d?.movimentos_clientes)) throw new Error("O backup completo ainda não inclui clientes. Aplique a atualização de melhorias no banco antes de continuar.");
            const pacote = await window.BackupClientes.montar({ clientes: d.clientes_conta, movimentos: d.movimentos_clientes }, new URL(SUPABASE_URL).hostname, registro.id);
            const url = URL.createObjectURL(new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json;charset=utf-8" }));
            const a = document.createElement("a"); a.href = url; a.download = `XBurguer-clientes-${hoje()}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status("Backup de clientes baixado com verificação de integridade. Uma cópia completa também foi guardada no banco.");
        } catch (erro) { status(mensagemErro(erro), true); }
        finally { salvando = false; atualizarBotoes(); }
    }
    function abrirRecuperacao() {
        if (!pronto || salvando) return;
        versaoArquivo++; backupSelecionado = null; analisandoBackup = false;
        $("form-backup").reset(); $("erro-backup-clientes").textContent = "";
        $("resumo-backup-clientes").textContent = "Nenhum arquivo selecionado.";
        atualizarBotoes(); $("dialog-backup").showModal();
    }
    async function analisarBackup() {
        const versao = ++versaoArquivo;
        backupSelecionado = null; analisandoBackup = true; atualizarBotoes();
        $("erro-backup-clientes").textContent = ""; $("resumo-backup-clientes").textContent = "Verificando arquivo...";
        try {
            const arquivo = $("arquivo-clientes").files?.[0];
            if (!arquivo) { $("resumo-backup-clientes").textContent = "Nenhum arquivo selecionado."; return; }
            if (arquivo.size > 20 * 1024 * 1024) throw new Error("O arquivo ultrapassa 20 MB.");
            const pacote = JSON.parse(await arquivo.text());
            const restaurar = await window.BackupClientes.validar(pacote, new URL(SUPABASE_URL).hostname);
            if (versao !== versaoArquivo) return;
            backupSelecionado = restaurar;
            $("resumo-backup-clientes").textContent = `Arquivo verificado: ${restaurar.clientes_conta.length} cliente(s) e ${restaurar.movimentos_clientes.length} lançamento(s). Os registros já existentes serão preservados.`;
        } catch (erro) {
            if (versao === versaoArquivo) { $("erro-backup-clientes").textContent = erro.message; $("resumo-backup-clientes").textContent = "Arquivo não aprovado para recuperação."; }
        } finally { if (versao === versaoArquivo) { analisandoBackup = false; atualizarBotoes(); } }
    }
    async function recuperarBackup(evento) {
        evento.preventDefault();
        if (!backupSelecionado || analisandoBackup) return;
        const recuperar = backupSelecionado;
        await salvar(evento.target, "erro-backup-clientes", "dialog-backup", async () => {
            const resultado = await rpc("restaurar_contas_clientes", { p_dados: recuperar });
            backupSelecionado = null;
            await registrarHistorico("Recuperou backup de clientes", `${Number(resultado?.total || 0)} registro(s) ausente(s) recuperado(s)`);
        }, "Recuperação concluída. Os registros atuais foram preservados e o banco guardou cópias antes e depois.");
    }
    window.addEventListener("DOMContentLoaded", () => {
        document.addEventListener("click", function (event) {
            document.querySelectorAll(".clientes-ferramentas[open]").forEach(function (menu) {
                const botao = event.target.closest("button");
                if (!menu.contains(event.target) || (botao && !botao.disabled && menu.contains(botao))) menu.open = false;
            });
        });
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") return;
            document.querySelectorAll(".clientes-ferramentas[open]").forEach(function (menu) {
                const tinhaFoco = menu.contains(document.activeElement);
                menu.open = false;
                if (tinhaFoco) menu.querySelector("summary").focus();
            });
        });

        $("novo-cliente").addEventListener("click", () => abrirCliente());
        $("atualizar-clientes").addEventListener("click", () => { if (!salvando) carregar(); });
        $("backup-clientes").addEventListener("click", baixarBackup);
        $("recuperar-clientes").addEventListener("click", abrirRecuperacao);
        $("arquivo-clientes").addEventListener("change", analisarBackup);
        $("form-backup").addEventListener("submit", recuperarBackup);
        ["busca-cliente", "situacao-cliente", "somente-pendentes"].forEach(id => $(id).addEventListener("input", () => { paginaClientes = 1; renderizarClientes(); }));
        ["extrato-inicio", "extrato-fim"].forEach(id => $(id).addEventListener("change", () => { paginaExtrato = 1; renderizarExtrato(); }));
        $("limpar-periodo").addEventListener("click", () => { paginaExtrato = 1; $("extrato-inicio").value = ""; $("extrato-fim").value = ""; renderizarExtrato(); });
        $("clientes-anterior").addEventListener("click", () => { paginaClientes--; renderizarClientes(); });
        $("clientes-proxima").addEventListener("click", () => { paginaClientes++; renderizarClientes(); });
        $("extrato-anterior").addEventListener("click", () => { paginaExtrato--; renderizarExtrato(); });
        $("extrato-proxima").addEventListener("click", () => { paginaExtrato++; renderizarExtrato(); });
        $("nova-notinha").addEventListener("click", () => abrirMovimento("notinha"));
        $("novo-pagamento").addEventListener("click", () => abrirMovimento("pagamento"));
        $("imprimir-extrato").addEventListener("click", imprimir);
        $("copiar-extrato").addEventListener("click", copiarResumo);
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
                paginaExtrato = 1;
                $("extrato-inicio").value = ""; $("extrato-fim").value = "";
                renderizarClientes();
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
    window.addEventListener("beforeprint", montarImpressao);
    window.addEventListener("offline", () => { pronto = false; atualizarBotoes(); status("Sem conexão. Os dados exibidos podem estar desatualizados; os lançamentos estão bloqueados até reconectar.", true); });
    window.addEventListener("online", () => { if (!salvando) carregar(); });
})();

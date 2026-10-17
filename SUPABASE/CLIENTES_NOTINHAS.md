# Clientes e Notinhas — versão 4.8.1

O cliente assina a comanda em papel e paga depois. A área registra data, mesa, valor total, observação e confirmação de assinatura em papel. Não armazena fotos nem assinatura digital.

## Antes da ativação

1. Gere o backup protegido atual no projeto Supabase **XBurguer Controle**.
2. Em instalação nova, aplique, nesta ordem, `migrations/20261017_clientes_notinhas.sql`, `migrations/20261017_clientes_melhorias.sql` e `migrations/20261017235408_editar_excluir_notinhas.sql`. Se Clientes e Notinhas já está ativo, aplique apenas a migration nova de edição/exclusão; não reaplique as anteriores.
3. Publique a versão 4.8.1. O cache do PWA inclui todos os novos arquivos.
4. Faça login autorizado e confira cadastro, notinha, pagamento e backup em computador e celular.

As funções reais de backup, recuperação e auditoria foram consultadas no projeto em **17/10/2026**. A migration de melhorias verifica se as definições de backup e recuperação continuam iguais antes de substituí-las. Se houver alteração posterior, ela aborta para revisão das diferenças. O agendamento diário e a retenção existentes são preservados. Não execute os SQLs históricos `ETAPA_*.sql`.

Não publique as migrations pela metade: a interface exige a versão nova do serviço de clientes e impede downloads de novos backups que omitiriam os clientes.

## Operação

- Cadastre o cliente e abra **Extrato**. Cadastros podem ser editados ou inativados; o histórico permanece. Inativos continuam disponíveis para consulta e recebimentos.
- O mesmo nome e telefone, desconsiderando maiúsculas, espaços extras e formatação do telefone, não pode criar dois cadastros. Uma edição feita em outra sessão não é sobrescrita silenciosamente.
- Em **+ Notinha**, informe data e valor total, mesa e observação quando houver. Marque a comanda assinada em papel.
- Em **Registrar pagamento**, informe data, valor e forma. É possível pagar parte ou quitar o saldo. O pagamento abate a conta, sem alocação a uma notinha específica.
- Cada notinha ativa tem **Editar** e **Excluir** no extrato. A edição preenche os dados atuais e permite corrigir data, mesa, valor, observação e assinatura em papel. O saldo é recalculado automaticamente.
- **Excluir notinha** pede confirmação, com motivo opcional, retira o valor do saldo e preserva a linha identificada como excluída no histórico e na impressão. Notinhas excluídas não podem ser editadas.
- Pagamentos mantêm **Cancelar**, com motivo obrigatório. Reduções e exclusões que deixariam o saldo negativo são rejeitadas; confira os pagamentos já recebidos antes de corrigir a notinha.
- Edição e exclusão conferem os dados originais no servidor. Se outra tela tiver alterado a notinha, feche a janela para sincronizar o extrato e conferir a versão recente antes de tentar novamente. Repetir uma gravação já concluída não duplica a operação.
- A busca aceita nomes com e sem acentos e telefones formatados ou somente dígitos. São 25 clientes e 50 lançamentos por página. Os totais, impressão e resumo consideram o período inteiro.
- **Imprimir / PDF** e a impressão do navegador geram o extrato com saldo anterior e final. **Copiar resumo** prepara texto para colar na conversa; não envia mensagens automaticamente.
- Os dados sincronizam automaticamente a cada 10 segundos e ao retornar à tela ou reconectar. Durante o preenchimento, a sincronização aguarda o fechamento da janela e preserva os campos. Sem conexão, as gravações ficam bloqueadas até a sincronização automática. O formulário fica travado durante o salvamento. Não há fila de gravações financeiras offline.

## Backup unificado e recuperação

A rotina diária existente, às **00:15 de São Paulo**, passa a incluir `clientes_conta` e `movimentos_clientes` nos mesmos backups protegidos do Controle de Consumo. Os arquivos completos de Configurações incluem clientes, notinhas, pagamentos, cancelamentos e revisões, além dos módulos anteriores.

**Baixar backup de clientes** cria uma cópia protegida completa no banco e baixa um JSON somente dos clientes, identificado pelo projeto e com verificação SHA-256. Guarde uma cópia fora do computador.

**Recuperar backup** aceita um JSON de clientes da versão 2 ou um backup completo da versão 3 contendo as duas tabelas. A tela verifica origem, estrutura e integridade e apresenta as quantidades antes da ação. O limite do arquivo é 20 MB.

A recuperação é transacional e insere somente registros ausentes. Não substitui cadastros atuais nem reativa notinhas excluídas ou pagamentos cancelados. Rejeita IDs conflitantes (inclusive notinhas corrigidas após o backup), valores inválidos, referências incompletas e dados que deixariam um saldo negativo. O banco cria backups protegidos antes e depois. Qualquer erro desfaz toda a tentativa.

A recuperação completa em Configurações reconhece as tabelas novas. Backups antigos continuam válidos e preservam os clientes atuais quando não contêm essa área. Auditoria e lixeira permanecem protegidas, seguindo o fluxo atual do sistema.

A implementação da recuperação completa fica encapsulada em uma função privada com autorização explícita. Isso permite conferir usuários históricos sem conceder leitura direta de `auth.users` ao aplicativo, corrigindo a incompatibilidade de permissões identificada na rotina anterior.

## Acesso e integridade

Somente a lista autorizada atual pode acessar clientes; `anon` é bloqueado. Escritas exigem RPC com validação no servidor. Não há exclusão definitiva pela interface. IDs únicos permitem repetir uma tentativa sem duplicar cobranças. Se a resposta de rede se perder, a tela tenta reconhecer o lançamento já gravado pelo ID.

Pagamentos, edições, exclusões e cancelamentos são serializados por cliente. Backups e recuperações coordenam um bloqueio com as gravações para preservar a consistência. Os gatilhos de auditoria existentes registram valores anteriores e posteriores, autor e horário das alterações, independentemente do histórico da tela. A migration nova acrescenta somente funções; mantém as tabelas e o formato dos backups existentes.

As funções expostas da área de clientes executam com as permissões do chamador e verificam a autorização. As implementações privilegiadas ficam no schema privado, com `search_path` fixado e permissões explícitas de execução. Os testes verificam esse isolamento, além do acesso aos dados.

## Validação

```sh
python scripts/auditar_site.py
node --test scripts/clientes-model.test.cjs scripts/clientes-backup.test.cjs
```

Os testes SQL devem rodar **somente em PostgreSQL vazio e descartável**. `preparar.sql` cria mocks de autenticação e tabelas; `funcoes-producao.sql` contém definições anteriores como fixtures. Nunca execute arquivos de teste no Supabase de produção.

```sh
psql -v ON_ERROR_STOP=1 \
  -f scripts/testes-clientes/preparar.sql \
  -f scripts/testes-clientes/funcoes-producao.sql \
  -f SUPABASE/migrations/20261017_clientes_notinhas.sql \
  -f SUPABASE/migrations/20261017_clientes_melhorias.sql \
  -f SUPABASE/migrations/20261017235408_editar_excluir_notinhas.sql \
  -f scripts/testes-clientes/verificar.sql \
  -f scripts/testes-clientes/melhorias.sql \
  -f scripts/testes-clientes/editar-excluir.sql
```

O workflow executa a auditoria, os testes de cálculos/backup, as migrations e a recuperação em PostgreSQL 16 descartável. Usa também processos simultâneos de `psql` em `concorrencia.py` para verificar pagamentos, edições de cadastro e conflitos entre edição/exclusão de notinhas e recebimentos. O fluxo da interface é validado localmente em navegador com banco de teste, sem gravar clientes reais.

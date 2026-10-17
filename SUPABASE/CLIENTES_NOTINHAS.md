# Clientes e Notinhas — versão 4.8.0

O cliente assina a comanda em papel e paga depois. Esta área registra o nome do cliente, data, mesa, valor total, observação e confirmação de assinatura em papel. Não armazena imagem da comanda nem assinatura digital.

## Publicação

1. No projeto Supabase **XBurguer Controle**, gere o backup protegido atual.
2. Aplique uma única vez a nova migration [`migrations/20261017_clientes_notinhas.sql`](migrations/20261017_clientes_notinhas.sql). Ela depende de `public.usuario_autorizado_atual()`, já utilizada pelo aplicativo, e cria duas tabelas e quatro RPCs. Não altera as tabelas dos funcionários nem as funções de backup existentes. Se a autorização atual não existir, a transação é abortada.
3. Publique o código da versão 4.8.0. O novo cache do PWA inclui a área de clientes.
4. Faça login com um usuário autorizado e confira o menu **Clientes e Notinhas** em computador e celular.

Sem a migration, a tela explica que a área ainda não foi habilitada e mantém os botões de gravação desativados. Não há armazenamento financeiro local nem fila de recebimentos offline.

## Uso

- Cadastre o cliente e abra **Extrato**. Cadastros podem ser editados ou inativados; o histórico permanece.
- Em **+ Notinha**, informe data e valor total, mesa e observação quando houver. Marque se a comanda foi assinada em papel.
- Em **Registrar pagamento**, informe a data, o valor e a forma de pagamento. É possível receber parte ou todo o saldo. O pagamento abate o saldo da conta, sem vincular uma quitação a uma notinha específica.
- Filtre o período e use **Imprimir / PDF** para entregar o extrato ao cliente. O extrato traz saldo anterior, lançamentos do período e saldo final. Os totais da página incluem todos os períodos e clientes ativos e inativos.
- Para corrigir um lançamento, use **Cancelar** com motivo e lance o valor correto. O original, autor, datas e motivo são preservados. Para cancelar uma notinha que deixaria o saldo negativo, corrija primeiro os pagamentos envolvidos.

## Acesso e integridade

Somente usuários da lista autorizada atual podem ler ou gravar. `anon` não tem acesso. Usuários autenticados têm apenas SELECT sujeito a RLS; escritas exigem RPC com validação no servidor. Cada movimentação tem ID único, autor e data de criação. Repetir uma requisição com o mesmo ID e conteúdo não duplica a cobrança. Cada operação bloqueia o cadastro do cliente durante a transação, evitando que dois pagamentos simultâneos ultrapassem o saldo. Não há exclusão definitiva pela interface.

## Backup

**Baixar backup de clientes** baixa um snapshot JSON com todos os clientes, notinhas, pagamentos, cancelamentos, autores e datas. Ele não contém dados de outros módulos. Guarde uma cópia fora do computador.

As cópias automáticas e a recuperação protegida em Configurações continuam cobrindo as tabelas anteriores; **não incluem estas duas tabelas novas**. A página de Configurações informa essa diferença. O JSON de clientes é um arquivo separado para recuperação técnica; não deve ser importado pela recuperação de funcionários. A recuperação de clientes e sua inclusão no backup automático exigem uma nova migration baseada nas funções atuais do projeto Supabase, que não estão versionadas neste repositório. Não substitua essas funções por versões dos SQLs históricos.

## Validação

```sh
python scripts/auditar_site.py
node --test scripts/clientes-model.test.cjs
```

Os testes de banco devem rodar **somente em um PostgreSQL vazio e descartável**. `preparar.sql` cria mocks de autenticação e falha se encontrar um schema `auth` existente. Nunca o execute no Supabase de produção.

```sh
psql -v ON_ERROR_STOP=1 \
  -f scripts/testes-clientes/preparar.sql \
  -f SUPABASE/migrations/20261017_clientes_notinhas.sql \
  -f scripts/testes-clientes/verificar.sql
```

O workflow roda esses testes no PostgreSQL 16, além da auditoria e dos testes de centavos/extratos. Os testes verificam pagamentos parciais e quitação, bloqueio de excesso e de frações de centavo, repetição de requisição, cancelamentos, clientes inativos, RLS e permissões. As tabelas e RPCs reais de produção precisam ser conferidas após aplicar a migration.

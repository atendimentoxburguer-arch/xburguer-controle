# Supabase — orientação de produção

Os arquivos `ETAPA_*.sql` desta pasta são **históricos** e não devem ser executados novamente no banco de produção.

A fonte oficial da estrutura atual é o histórico de **migrations aplicado no projeto Supabase `XBurguer Controle`**. As migrations atuais incluem proteção por lista de usuários autorizados, integridade operacional, auditoria/lixeira, backups protegidos, backup automático, restauração segura, edição controlada de consumos e endurecimento de segurança.

Antes de qualquer mudança de schema ou política RLS, use uma nova migration. Não copie permissões de arquivos antigos para produção.

O arquivo `AUDITAR_USUARIOS_AUTH.sql` é somente de consulta/auditoria e não altera dados.

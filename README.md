# X-Burguer — Controle de Consumo

Este repositório contém **somente o sistema de Controle de Consumo**.

- GitHub Pages: `/xburguer-controle/`
- PWA ID: `/xburguer-controle/consumo-app`
- Service Worker: `service-worker.js`
- Escopo do PWA: `/xburguer-controle/`
- Banco: projeto Supabase exclusivo do Controle de Consumo

A versão 4.8.0 acrescenta **Clientes e Notinhas**, com cobrança posterior, pagamentos parciais e extrato para impressão. Veja [publicação, migration e backup de clientes](SUPABASE/CLIENTES_NOTINHAS.md) antes de publicar essa versão.

O **Controle de Caixa** fica no repositório `xburguer-caixa`, usa o caminho `/xburguer-caixa/`, outro PWA, outro cache e outro projeto Supabase.

## Regra de organização

Arquivos, alterações, workflows e configurações do Controle de Caixa não devem ser adicionados neste repositório. Da mesma forma, arquivos do Controle de Consumo não devem ser adicionados ao repositório do Caixa.

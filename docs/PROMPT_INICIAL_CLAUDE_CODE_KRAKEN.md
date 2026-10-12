# Prompt inicial para Claude Code — Kraken Ads

Leia integralmente `ESPECIFICACAO_MVP_KRAKEN.md`.

**Não escreva código nesta primeira etapa.** Faça apenas uma auditoria.

1. Inspecione o repositório, README, dependências, estrutura, scripts, testes, configurações e estado do Git.
2. Não altere arquivos, banco, migrações, secrets, variáveis, deploy ou serviços.
3. Compare a arquitetura existente com a especificação.
4. Informe o que já existe, o que falta, incompatibilidades e riscos confirmados.
5. Proponha um plano curto, dividido em etapas pequenas e testáveis.
6. Liste somente decisões que realmente bloqueiem o início. Não reabra decisões já tomadas nem invente requisitos.
7. Aguarde autorização explícita antes de alterar arquivos, executar migrações ou fazer deploy.



## Regras essenciais

- Prioridade: player publicitário contínuo de imagens e vídeos.
- O estabelecimento abre o endereço no navegador da TV, autentica e recebe automaticamente campanhas elegíveis do próprio estabelecimento.
- Não criar painel de TVs, ativação manual, grupos de telas ou configuração por dispositivo.
- Métrica principal: inserções concluídas por campanha, com sincronização offline idempotente.
- Frequências baixa/média/alta com pesos iniciais 1:2:3.
- Sem playlist institucional ou programação de TV.
- YouTube é prova de conceito separada e não pode bloquear o MVP.
- Sem pagamentos, split, comissões, garantia de inserções diárias ou relatórios avançados nesta fase.
- Monólito modular; não criar microserviços.
- Não trocar tecnologias nem ampliar escopo sem justificar e pedir autorização.
- Seja objetivo e econômico em tokens; trabalhe uma etapa por vez.
- Nenhuma mudança de produção, banco ou infraestrutura sem autorização explícita.



## Entrega desta primeira execução

Entregue somente:

1. resumo da arquitetura encontrada;
2. comparação com a especificação;
3. riscos/bloqueios confirmados;
4. plano de implementação por etapas;
5. primeira etapa recomendada.

Não implemente nada até receber autorização explícita.
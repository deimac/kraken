# Kraken Ads — Plano de implementação do MVP

Este plano é preliminar e deve ser ajustado após a auditoria do repositório. Não iniciar implementação sem autorização.

## Etapa 0 — Auditoria sem alterações

Inspecionar arquitetura, dependências, testes, configurações, Git e ambiente. Comparar com a especificação e propor um plano ajustado.

**Aceite:** diagnóstico e plano revisado, sem arquivos alterados.

## Etapa 1 — Fundação e isolamento por parceiro

Confirmar/configurar banco e migrações; modelar parceiro, usuários/permissões, anunciantes, campanhas e mídia de acordo com a arquitetura existente; testar isolamento entre parceiros.

**Aceite:** um parceiro não consegue consultar nem modificar dados de outro.

## Etapa 2 — Anunciantes, mídia e campanhas

Implementar cadastro manual e auto cadastro pelo portal usando o mesmo modelo; upload validado; fluxo de revisão, rejeição com motivo, correção e reenvio; histórico mínimo.

**Aceite:** só campanhas aprovadas e válidas podem entrar na rotação.

## Etapa 3 — Player publicitário

Autenticação no navegador da TV; carregamento automático das campanhas elegíveis do parceiro; reprodução contínua de imagens e vídeos; rotação ponderada 1:2:3; recuperação de falhas de mídia; tela simples de espera quando não houver campanhas.

**Aceite:** após autenticar, a TV começa a exibir anúncios do parceiro correto automaticamente.

## Etapa 4 — Contagem de inserções

Gerar evento após término natural do vídeo ou conclusão do tempo de exibição da imagem; enviar eventos com identificador único; contagem agregada por campanha.

**Aceite:** interrupções não contam como inserções concluídas e reenvios não duplicam contagem.

## Etapa 5 — Cache e modo offline

Armazenar mídia elegível localmente; continuar reprodução sem conexão; enfileirar eventos; sincronizar eventos e atualizações após reconexão; preservar mídia válida se uma atualização falhar.

**Aceite:** interrupção de internet não para a reprodução de mídia em cache e os eventos pendentes sincronizam sem duplicidade.

## Etapa 6 — Validação no equipamento do piloto

Testar no navegador e modelo de Fire TV disponíveis: vídeo, áudio, memória, retomada após suspensão/reabertura, cache e reconexão.

**Aceite:** fluxos prioritários funcionam no equipamento real do piloto.

## Etapa 7 — Prova de conceito YouTube

Somente depois de validar o player publicitário. Testar compatibilidade e documentar limitações. Não bloquear ou ocultar anúncios do YouTube e não criar dependência no player publicitário.

**Aceite:** relatório técnico de viabilidade separado, sem alterar o escopo do MVP principal.

## Fora do escopo

Pagamentos, split, comissões, preços finais, garantias de inserções, programação avançada, painéis complexos de dispositivos e integração com Xplore OS 360.
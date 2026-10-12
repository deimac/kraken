# Kraken Ads — Especificação Técnica do MVP

**Versão:** 0.1  
**Data:** 10/10/2026  
**Status:** Planejamento. Não implementar itens fora do escopo sem autorização.

## 1. Objetivo

Construir uma plataforma web independente para distribuir anúncios em TVs de estabelecimentos parceiros usando o navegador. O MVP deve reproduzir continuamente imagens e vídeos publicitários e contabilizar as inserções por campanha. O piloto inicial é a Ironberg, mas a arquitetura deve permitir múltiplos parceiros.

## 2. Escopo

### 2.1 Player publicitário — prioridade máxima

1. O estabelecimento abre o endereço do Kraken Ads no navegador da TV.
2. Autentica-se.
3. O sistema identifica o estabelecimento associado à conta.
4. O player carrega automaticamente as campanhas elegíveis daquele parceiro.
5. Reproduz anúncios continuamente, sem playlist de conteúdo institucional ou programação de TV.
6. Cada reprodução concluída gera uma inserção contabilizada para a campanha.
7. Se a internet cair, o player continua com arquivos válidos em cache e guarda os eventos pendentes para sincronização posterior.

Não criar painel de gerenciamento de TVs, ativação manual de telas, grupos de telas ou configuração por dispositivo.

### 2.2 Player YouTube — prova de conceito separada

Investigar isoladamente a compatibilidade do YouTube com o navegador de Fire TV utilizado no piloto. Esse experimento não pode atrasar nem ser dependência do player publicitário. Não prometer reprodução sem anúncios do YouTube nem implementar mecanismos para bloquear, ocultar ou substituir seus anúncios. A alternância entre YouTube e anúncios Kraken Ads fica para uma fase futura.

## 3. Fora do escopo

- Pagamentos, cobrança online, split ou comissões automáticas.
- Garantia de quantidade fixa de inserções por dia.
- Prova de audiência humana.
- Playlist institucional ou programação de TV.
- Agendamento avançado, segmentação complexa ou seleção manual por TV.
- Painel avançado de telemetria ou gerenciamento de dispositivos.
- Integração com Xplore OS 360.
- Alternância entre YouTube e anúncios.
- Aplicativo nativo, salvo se a validação real do player web mostrar que ele não atende ao piloto e houver autorização para rever o escopo.



## 4. Papéis



### Administrador Kraken Ads

Administra a plataforma e os parceiros. Pode gerir anúncios institucionais próprios em fluxo separado. Não aprova campanhas comerciais de terceiros.

### Parceiro/estabelecimento

Administra seus anunciantes, planos e campanhas; aprova ou rejeita materiais; configura níveis de frequência oferecidos; consulta inserções por campanha.

### Anunciante

Pode ser cadastrado manualmente pelo parceiro ou se registrar pela página do parceiro. Envia material, acompanha o estado da campanha e consulta métricas básicas conforme permissões.

Cadastro manual e autoatendimento devem usar o mesmo modelo de dados e fluxo.

## 5. Páginas e planos dos parceiros

Cada parceiro terá uma página própria para apresentar seus planos e receber cadastros de anunciantes. Domínio e white-label serão definidos posteriormente; não acoplar a lógica a um único domínio.

O parceiro poderá configurar os níveis de frequência. O modelo comercial definitivo — período, quantidade de inserções ou ambos — ainda não foi decidido. Não inventar preços, quotas ou garantias.

## 6. Ciclo de vida da campanha

Estados mínimos sugeridos:

- `draft`: em preparação.
- `pending_review`: aguardando aprovação.
- `changes_requested`: rejeitada com solicitação de correção.
- `approved`: aprovada, aguardando início.
- `active`: elegível para exibição no período válido.
- `ended`: período encerrado.
- `cancelled`: cancelada, se necessário.

Fluxo:

1. Anunciante cadastrado manualmente ou pelo portal.
2. Envia dados da campanha e arquivo de imagem ou vídeo.
3. Campanha é enviada para análise do parceiro.
4. O parceiro aprova ou rejeita; ao rejeitar, informa o motivo e solicita correção.
5. O anunciante substitui o material e reenvia para aprovação.
6. Campanha aprovada só é reproduzida dentro das datas e condições válidas.
7. Ao terminar o período, deixa de ser elegível e seu histórico é preservado.

Campanhas em `pending_review` ou `changes_requested` não podem ser exibidas. Guardar histórico mínimo de decisões, data e responsável.

## 7. Frequência de anúncios

Três níveis com pesos iniciais configuráveis:


| Nível | Peso |
| ----- | ---- |
| Baixa | 1    |
| Média | 2    |
| Alta  | 3    |


Usar rotação ponderada entre campanhas elegíveis. Em condições equivalentes, frequência alta deve ter mais oportunidades de inserção que baixa. Os pesos representam participação relativa, não garantia de impressões diárias. Não criar quotas diárias fixas.

## 8. Elegibilidade

Uma campanha comercial pode entrar na rotação quando:

- Pertence ao parceiro autenticado no player.
- Está aprovada e dentro do período válido.
- Possui mídia válida e disponível localmente ou passível de download.
- Cumpre as condições simples definidas para o MVP.

Nunca mostrar campanha comercial de outro parceiro. Anúncios institucionais Kraken Ads devem ser identificados separadamente e seguir o acordo aplicável ao estabelecimento, sem aprovação individual pelo parceiro.

Não adicionar regras avançadas de segmentação ou janelas horárias sem decisão explícita.

## 9. Reprodução e contagem de inserções

A métrica principal é **inserções concluídas por campanha**.

- Vídeo: contar ao terminar naturalmente; não contar início, erro ou interrupção.
- Imagem: contar após completar o tempo de exibição configurado.
- Cada evento deve ter identificador único, campanha, parceiro, horário do player, tipo de mídia e estado de sincronização.
- Eventos podem ser enviados em lote.
- Repetir o envio do mesmo evento não pode duplicar a contagem no servidor.
- Exibir contagem agregada por campanha, sem painel avançado de dispositivos.

Uma inserção é um evento técnico de reprodução; não prova que uma pessoa viu o anúncio.

## 10. Offline

- Baixar e armazenar localmente mídia necessária às campanhas elegíveis.
- Continuar a reprodução com mídia válida em cache quando a conexão cair.
- Guardar eventos pendentes localmente.
- Ao voltar a conexão, sincronizar eventos e buscar atualizações.
- A API deve aceitar reenvios de forma idempotente.
- Se uma atualização falhar, preservar a última mídia válida em cache.

Não transformar isso em um sistema complexo de monitoramento de TVs.

## 11. Configurações do player

- Suportar imagens e vídeos enviados à plataforma, sem limite artificial de três ou quatro itens.
- Permitir configurar duração das imagens.
- Permitir transições simples, se forem confiáveis no navegador alvo.
- Permitir controle de áudio conforme as capacidades do navegador/TV.
- Recuperar-se de falhas de mídia sem parar toda a sequência.
- Quando não houver campanha elegível, mostrar uma tela simples de espera, sem travar ou ficar preta, e verificar novamente quando houver conexão.



## 12. Arquitetura técnica sugerida

Monólito modular, sem microserviços:

- Frontend: React + Vite + TypeScript.
- Backend/API: Node.js + Fastify + TypeScript.
- Banco: PostgreSQL.
- ORM/migrações: Drizzle.
- Arquivos: armazenamento compatível com S3.
- Player: aplicação web própria, validada no navegador real da Fire TV do piloto.
- Deploy: considerar VPS/Coolify após inspecionar o repositório e ambiente existentes.

Módulos lógicos: autenticação/permissões, parceiros, anunciantes, planos/frequência, campanhas/aprovação, mídia, player/seleção e eventos/sincronização. Não separar em serviços independentes no MVP.

## 13. Segurança e isolamento

- Dados de campanhas, anunciantes e planos devem estar associados ao parceiro correto.
- Validar permissões no servidor, não apenas na interface.
- Um parceiro não pode ler ou alterar dados de outro.
- Validar tipo e tamanho dos uploads; aceitar somente formatos de mídia permitidos.
- Não expor credenciais ou segredos no frontend.
- A autenticação do player identifica o parceiro sem exigir ativação manual de cada TV.
- Se houver sessão persistente no navegador, documentar como sair ou trocar de conta para evitar uso acidental da conta errada em TV compartilhada.



## 14. Critérios de aceite

1. Parceiro cadastra anunciante manualmente.
2. Anunciante também pode se cadastrar pela página do parceiro; ambos os fluxos usam o mesmo modelo.
3. Anunciante envia imagem ou vídeo.
4. Parceiro aprova ou rejeita com motivo; o material pode ser corrigido e reenviado.
5. Campanha não aprovada nunca entra na rotação.
6. Player no navegador, após autenticação, carrega campanhas do parceiro automaticamente.
7. Player reproduz imagens e vídeos continuamente, sem programação institucional.
8. Frequências baixa/média/alta participam da rotação com pesos 1:2:3.
9. Campanhas de parceiros diferentes permanecem isoladas.
10. Reprodução concluída gera uma inserção.
11. Reenvio de evento não duplica a contagem.
12. Sem internet, mídia válida em cache continua tocando e eventos ficam pendentes.
13. Após reconexão, eventos são sincronizados sem duplicidade.
14. Sem campanhas elegíveis, player mostra tela simples de espera e não trava.
15. YouTube é testado separadamente e não bloqueia a entrega do player publicitário.



## 15. Decisões futuras — não inventar

- Modelo comercial definitivo e preços.
- Quotas exatas ou garantia de inserções.
- Horários e regras avançadas.
- Domínio e white-label das páginas.
- Pagamentos, comissões e divisão de receitas.
- Formato do YouTube e alternância com anúncios.
- Aplicativo nativo, somente se necessário e aprovado.



## 16. Instrução de escopo

Antes de implementar, inspecionar o repositório e o ambiente real. Apresentar plano enxuto e apontar incompatibilidades reais. Não trocar tecnologias, criar módulos extras ou executar migrações/deploy sem autorização. Trabalhar em etapas pequenas, com testes e critérios de aceite.
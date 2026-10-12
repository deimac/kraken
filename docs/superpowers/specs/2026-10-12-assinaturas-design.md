# Kraken Ads — Reestruturação comercial (Anunciantes, Planos, Assinaturas)

Data: 2026-10-12. Complementa `2026-10-11-kraken-ads-mvp-design.md` e **substitui suas seções 5 (campanhas/mídia) e 6 (ciclo de vida da campanha)**. Pré-requisito: a renomeação Kraken Ads já estar mergeada na `main`.

## 1. Problema
Nos testes em produção, o fluxo de "campanha" ficou confuso. Uma campanha aceita um único arquivo e o parceiro precisa enviar para aprovação e aprovar a si mesmo. O nome também não reflete o negócio, em que o anunciante **assina um plano** do parceiro por um período. Os cadastros estão incompletos: falta documento, endereço, edição e arquivamento. O painel também mostra pouca informação.

## 2. Decisões
| # | Decisão |
|---|---|
| A1 | "Campanha" passa a se chamar **Assinatura**: Anunciante + Plano + vigência (início e fim). Uma assinatura contém várias **peças** (vídeos e imagens). |
| A2 | O **Plano** define frequência, limite de vídeos, limite de imagens, duração máxima de vídeo, preço e período (1, 3, 6 ou 12 meses). |
| A3 | Peça enviada pelo **parceiro** vai direto ao ar. Peça enviada pelo **anunciante** passa pela aprovação do parceiro, e a recusa exige motivo. |
| A4 | Anunciante com assinatura é **arquivado**, nunca apagado. A exclusão definitiva só é permitida se ele nunca teve assinatura. |
| A5 | Cobrança: só registro. A assinatura guarda uma cópia do preço e a situação do pagamento (pendente ou pago), marcada à mão. |
| A6 | Fora do escopo: stories do Instagram, regras de renovação e vigência (futura área de configurações do parceiro) e integração de pagamento (etapa da venda no site). |
| A7 | As institucionais do admin continuam como estão para o usuário. Internamente, viram assinaturas `kind = institutional`, sem anunciante e sem plano. |

## 3. Modelo de dados
Todas as migrações renomeiam ou adicionam colunas, sem `DROP` de dados. São testadas com PGlite sobre dados no formato atual.

**advertisers**: os campos atuais, mais:
- `person_type` (`pf`|`pj`, padrão `pj`);
- `document` (só dígitos; CPF com 11 ou CNPJ com 14, validado por dígito verificador; único por parceiro quando preenchido; obrigatório nos cadastros novos e opcional nos antigos);
- `legal_name`, `whatsapp`, `notes`;
- endereço: `zip`, `street`, `number`, `complement`, `district`, `city`, `state` (UF);
- `archived_at`.

`name` passa a ser o nome fantasia (ou o nome da pessoa, no caso de PF).

**plans** (do parceiro): os campos atuais, mais:
- `max_videos` e `max_images` (≥ 0, com pelo menos um > 0);
- `max_video_seconds` (padrão 30);
- `price_cents` (≥ 0);
- `period_months` (1|3|6|12);
- `archived_at`.

`active` é removido da API e passa a ser derivado de `archived_at` (a coluna sai na migração, depois de convertida).

**subscriptions** (rename de `campaigns`): `partner_id`, `advertiser_id`, `plan_id`, `kind`, `name`, `starts_at`, `ends_at`, `frequency_level` (copiado do plano), mais:
- `price_cents` (cópia do preço do plano);
- `payment_status` (`pending`|`paid`);
- `status` (`active`|`paused`|`cancelled`).

Os status de exibição são derivados das datas: `scheduled` antes do início, `active` dentro da vigência, `ended` depois do fim.

Conversão dos dados atuais:
- `approved` → `active`;
- `draft`, `pending_review` e `changes_requested` → `paused`;
- `cancelled` → `cancelled`.

O `name` fica opcional. Quando vazio, a tela mostra "Anunciante · Plano".

**media** (peças): `campaign_id` → `subscription_id`, mais:
- `status` (`pending_review`|`approved`|`rejected`|`removed`);
- `review_reason`;
- `uploaded_by` (user id).

Conversão: a mídia apontada por `current_media_id` vira `approved`, e as demais viram `removed`. Depois disso a coluna `campaigns.current_media_id` é removida.

**piece_reviews** (rename de `campaign_reviews`): `media_id`, `action` (`submitted`|`approved`|`rejected`|`removed`), `reason`, `actor_user_id`, `created_at`. O histórico antigo é associado à peça atual da campanha.

**plays**: `campaign_id` → `subscription_id`. `media_id` continua igual.

**partners**: adiciona `tv_last_seen_at`, atualizado no `GET /api/player/manifest` no máximo uma vez por minuto.

## 4. Regras
- **Limites:** em cada assinatura, a soma das peças `approved` e `pending_review` de cada tipo não pode passar de `max_videos`/`max_images` do plano. O plano vale no momento do envio; os valores copiados na assinatura não mudam se o plano for editado depois. Erros:
  - limite excedido → `409 plan_limit`;
  - vídeo mais longo que `max_video_seconds` → `422 video_too_long`.
- **Remover peça:** o parceiro pode remover qualquer peça, e ela vira `removed` (o arquivo é mantido). O anunciante só pode remover peças `pending_review` ou `rejected`.
- **Elegível para a TV:** assinatura `active`, dentro da vigência e de parceiro ativo, mais peças `approved`. Institucionais entram com a regra atual (`show_institutional`).
- **Rodízio:** o peso de frequência é da assinatura. O manifest lista assinaturas, cada uma com suas peças. O player usa o rodízio ponderado atual sobre as assinaturas e, dentro de cada assinatura, alterna as peças em ordem (round-robin). Exemplo: uma assinatura "alta" com 2 peças e uma "baixa" com 1 peça dão 3 exibições da alta para cada 1 da baixa, ou seja, 1,5 exibição de cada peça da alta por exibição da baixa.
- **Arquivar anunciante:** pausa as assinaturas ativas dele e esconde o anunciante das listas, a não ser com o filtro "arquivados". Desarquivar não reativa as assinaturas sozinho.
- **Excluir anunciante:** permitido só sem nenhuma assinatura; caso contrário, `409 has_subscriptions`. Remove também o usuário anunciante associado.
- **Plano arquivado:** some da criação de novas assinaturas e da página pública. As assinaturas existentes não mudam.
- **Pagamento:** só o parceiro altera `payment_status`. A situação do pagamento não afeta a exibição; isso será decidido nas configurações futuras.

## 5. API (resumo)
- **Anunciantes:** `GET /api/partner/advertisers?q=&archived=`, `POST`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id`, `GET /:id` (dados, assinaturas e inserções no mês).
- **Planos:** `GET|POST /api/partner/plans`, `PATCH /:id`, `POST /:id/archive|unarchive`. A rota pública passa a expor preço, período e limites.
- **Assinaturas:**
  - Rotas: `GET|POST /api/subscriptions`, `GET|PATCH /api/subscriptions/:id`, `POST /:id/pause|resume|cancel`, `PATCH /:id/payment`.
  - Peças: `POST /api/subscriptions/:id/pieces` (multipart), `POST /api/pieces/:id/approve|reject|remove`.
  - Escopo por papel: o parceiro vê as assinaturas dele e o anunciante vê as próprias.
- **Institucionais:** `/api/admin/institutional` com o mesmo modelo de peças. O admin envia peças já aprovadas.
- **Relatórios:** por assinatura, com detalhe por peça e por dia. O CSV traz as colunas assinatura, anunciante, peça, dia e inserções.
- **Dashboard:** `GET /api/dashboard` devolve cards conforme o papel (seção 6).
- **Player:** o manifest passa a ser `{ subscriptions: [{ id, weight, pieces: [...] }], ... }`. `POST /api/player/plays` aceita `subscriptionId` e, durante a transição, continua aceitando `campaignId` vindo de TVs ainda não recarregadas.

## 6. Painel
- **Componentes novos (`ui.tsx`):** `StatCard`, `SearchInput`, `ConfirmDialog`, `EmptyState`, `IconButton`. Todos os botões e itens de lista com ícone Tabler.
- **Início, por papel:**
  - **Parceiro:** assinaturas ativas, anunciantes ativos, peças aguardando aprovação, assinaturas vencendo em 30 dias, inserções hoje e nos últimos 7 dias, TV online (visto há menos de 10 min) ou offline (com horário).
  - **Anunciante:** inserções no mês, peças no ar, assinaturas.
  - **Admin:** parceiros ativos, TVs online/total, inserções nos últimos 7 dias.
- **Anunciantes:**
  - lista com busca, filtro de arquivados e cards;
  - formulário PF/PJ com máscaras (CPF/CNPJ, CEP, telefone);
  - página do anunciante com dados, assinaturas e inserções;
  - ações: editar, arquivar, desarquivar e excluir (com confirmação).
- **Planos:** cards de vitrine com preço/período, limites e frequência; editar; arquivar.
- **Assinaturas:**
  - **Lista:** busca e filtros por situação.
  - **Criação:** anunciante e plano em uma tela; o início é hoje e o fim é sugerido por `period_months` (editável).
  - **Página da assinatura:** vagas usadas ("Vídeos 1/2 · Imagens 0/3"), grade de peças com prévia e status, envio de várias peças, pausar/reativar/cancelar, pagamento e inserções.
- **Relatórios:** gráfico de barras por dia em SVG próprio, sem biblioteca nova.

## 7. Entrega
Quatro sub-etapas, cada uma com plano próprio, branch, TDD, CI, revisão final e merge:
- **S1:** Anunciantes.
- **S2:** Planos.
- **S3:** Assinaturas e peças. Inclui migração, player, relatórios e institucionais.
- **S4:** Dashboard e acabamento visual.

A migração S3 só vai para produção depois de avisar o usuário e confirmar que o backup do banco do dia existe.

## 8. Riscos
- **TVs com player antigo:** durante o deploy da S3, uma TV com o player antigo envia `campaignId`. A API aceita os dois nomes (5), e o manifest novo força o player a recarregar quando a versão mudar.
- **Dados antigos sem documento:** a validação do documento só é obrigatória em cadastros novos ou quando o campo é editado.
- **Rodízio:** a mudança de peso por peça para peso por assinatura altera a proporção das campanhas atuais. É aceitável, porque cada campanha atual vira uma assinatura com uma peça, e a proporção continua igual.

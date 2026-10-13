# S3 — Assinaturas e peças — Implementation Plan

> Executar com superpowers:executing-plans (inline, TDD, ledger em `.superpowers/sdd/`).

**Goal:** a "campanha" vira **Assinatura** (anunciante + plano + vigência) com várias **peças**. Peças do parceiro entram aprovadas; as do anunciante esperam aprovação. Os limites do plano valem no envio. A assinatura pode ser pausada, reativada e cancelada, e o pagamento é registrado à mão. O player alterna as peças dentro de cada assinatura, e os relatórios mostram o detalhe por peça.
**Spec:** `docs/superpowers/specs/2026-10-12-assinaturas-design.md` (§2–§6).

## Rulings de projeto (desvios da spec)
- **R1.** Nomes internos continuam `campaigns`, `campaign_id`, `/api/campaigns`; só as telas dizem "Assinatura". Motivo: as TVs enviam `campaignId`, e renomear exigiria uma fase de compatibilidade e mexer em ~3.500 linhas sem ganho para o usuário. Custo se errado: um rename mecânico depois.
- **R2.** O histórico continua em `campaign_reviews` (uma linha do tempo por assinatura), ganhando `media_id` e as ações novas, em vez de uma tabela `piece_reviews`.
- **R3.** `partners.tv_last_seen_at` fica para a S4 (dashboard), onde é usado.

## Global Constraints
- Migração `0008_subscriptions`:
  - **Status:** `approved` → `active`; `draft`/`pending_review`/`changes_requested` → `paused`; `cancelled` fica igual. O check do status passa a `('active','paused','cancelled')`.
  - **Campanhas:** colunas `price_cents` (copiado do plano atual) e `payment_status` (`pending`|`paid`, padrão `pending`).
  - **Mídia:** colunas `status` (`pending_review`|`approved`|`rejected`|`removed`), `review_reason`, `uploaded_by` (FK users, set null) e `original_name`. A mídia apontada por `current_media_id` vira `approved` e as demais viram `removed`. Depois disso, `DROP COLUMN current_media_id`.
  - **Histórico:** `campaign_reviews` ganha `media_id` (FK media, set null). Ações: `submitted`, `approved`, `changes_requested`, `cancelled` (legado) + `created`, `paused`, `resumed`, `payment`, `piece_added`, `piece_submitted`, `piece_approved`, `piece_rejected`, `piece_removed`.
- **Status efetivo:** `active` + datas → `scheduled`/`active`/`ended`; senão `paused`/`cancelled`.
- **Elegível na TV:** campanha `active`, dentro da vigência, anunciante não arquivado e parceiro ativo, com peças `approved` (todas as peças aprovadas entram).
- **Limites:** `approved` + `pending_review` de cada tipo ≤ limite do plano atual da campanha (institucional sem limite) → `409 plan_limit`. Vídeo com mais segundos que `max_video_seconds` → `422 video_too_long`. A checagem roda dentro de uma transação com `FOR UPDATE` na campanha.
- **Papéis:**
  - O parceiro cria assinatura já `active`; quando o anunciante cria, ela fica `paused` até o parceiro reativar.
  - Peça enviada pelo parceiro/admin → `approved`; pelo anunciante → `pending_review`.
  - O parceiro remove qualquer peça; o anunciante só remove as suas em `pending_review`/`rejected`.
  - Pausar, reativar, cancelar e marcar pagamento: só o parceiro.

## Review Focus
1. Migração sobre dados reais: campanha aprovada com 2 mídias no histórico → 1 peça `approved` + 1 `removed`; os plays continuam ligados; `current_media_id` sumiu.
2. Duas peças enviadas ao mesmo tempo no último slot do plano → apenas uma aceita.
3. Plano trocado por um menor: peças já aprovadas continuam; envios novos respeitam o limite novo.
4. Rodízio: assinatura `high` (peso 3) com 2 peças contra `low` (peso 1) com 1 peça → 3:1 por assinatura e 1,5:1 por peça; sem a mesma peça duas vezes seguidas quando há alternativa.
5. O anunciante não vê, não aprova nem remove peças de outro anunciante; o player não baixa peça `pending_review`/`removed`.

### Task 1: Migração, schema, status e elegibilidade
- `schema.ts`, `drizzle/0008_subscriptions.sql` (escrito à mão, com a conversão de dados), `campaigns/status.ts`, `campaigns/eligibility.ts`.
- Testes: `test/migration-subscriptions.test.ts` (padrão de `migration-kraken-plans.test.ts`) e `eligibility.test.ts` adaptado (várias peças, `pending`/`removed` fora).

### Task 2: API de assinaturas e peças
- **`campaigns/routes.ts`** reescrito:
  - `GET /api/campaigns` (com planName, pieceCounts, paymentStatus);
  - `GET /:id` (campanha, plano com limites, peças não removidas, reviews, totalPlays);
  - `POST`, `PATCH` (parceiro: nome, datas, plano);
  - `POST /:id/pause|resume|cancel`, `PATCH /:id/payment`;
  - `POST /:id/pieces` (multipart);
  - `POST /:id/pieces/:mediaId/approve|reject|remove`.
- **`media/attach.ts` → `addPiece`:** limites, status por papel e `original_name`.
- **`campaigns/admin-routes.ts`:** institucional `active`, peças aprovadas, cancelar e remover peça.
- **`media/routes.ts`:** o advertiser só lê as peças das próprias assinaturas (sem mudança); o player usa `listEligible`.
- **Testes:** `campaigns.test.ts` reescrito; ajustes em `media-routes.test.ts`, `player.test.ts`, `plays.test.ts`, `upload-abuse.test.ts` e `catalog.test.ts`.

### Task 3: Relatórios por peça
- `reports/query.ts`: cada linha ganha `pieces: [{ mediaId, label, mediaType, total }]`.
- CSV: `assinatura;anunciante;tipo;peça;dia;insercoes`.
- Testes em `reports.test.ts`.

### Task 4: Player — rodízio por assinatura
- `apps/player/src/rotation.ts`: o rodízio ponderado opera sobre as assinaturas (agrupadas por `campaignId`), com round-robin das peças dentro de cada uma.
- Testes em `rotation.test.ts` (proporções do Review Focus 4).

### Task 5: Painel
- **Navegação e rotas:** "Assinaturas"/"Minhas assinaturas", rotas `/parceiro/assinaturas` e `/anunciante/assinaturas` (redirecionando de `/campanhas`). `types.ts`, `format.ts` (rótulos dos status novos) e `messages.ts`.
- **`pages/subscriptions/SubscriptionList.tsx`:** cards (no ar, pausadas, peças aguardando, pagamento pendente), busca e linhas com anunciante · plano · vigência · peças · pagamento.
- **`SubscriptionForm.tsx`:** anunciante e plano (com resumo do plano); início hoje e fim sugerido pelo período; nome opcional.
- **`SubscriptionDetail.tsx`:**
  - ações pausar/reativar/cancelar e pagamento;
  - cards de inserções e vagas ("Vídeos 1/2");
  - grade de peças com prévia, status e ações aprovar/recusar/remover;
  - envio de vários arquivos e histórico.
- **Outras telas:** `admin/Institutional.tsx` (peças), `reports/Reports.tsx` (detalhe por peça), `partner/AdvertiserDetail.tsx` (textos "assinaturas").
- **Testes:** `campaigns.test.tsx` → `subscriptions.test.tsx`; ajustes em `admin.test.tsx`, `reports.test.tsx` e `catalog.test.tsx`.

### Task 6: Verificação e entrega
- **Checagens:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **Demo:** `demo.ts` com uma assinatura de 2 vídeos reais (opcional via pasta). No navegador: criar assinatura, enviar 2 vídeos, ver o 3º recusado pelo limite; anunciante envia imagem → parceiro aprova; player.
- **Docs:** `DEPLOY.md`.
- **Entrega:**
  - push, CI e revisão final (Opus) com correções;
  - antes do merge, **avisar o usuário e conferir o backup do banco do dia** (migração com DROP de coluna derivada);
  - merge e conferência do deploy.

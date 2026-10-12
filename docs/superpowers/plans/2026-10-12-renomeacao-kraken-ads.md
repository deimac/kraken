# Etapa K — Renomeação Midora → Kraken Ads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O produto passa a se chamar Kraken Ads no código, no banco, nos textos, no GitHub e no Coolify, sem perder dados do banco.

**Architecture:** Renomeação em camadas, cada uma verificável sozinha: pacotes `@midora/*` → `@kraken/*`; tabela/coluna/rotas "Planos Midora" → "Planos Kraken" por migração de `RENAME` (sem recriar nada); cookies e chaves de `localStorage` trocados direto, sem compatibilidade (ver Decisões); textos e docs. A infraestrutura já foi renomeada pelo usuário.

**Tech Stack:** o atual (pnpm workspaces, Fastify + `@fastify/cookie`, Drizzle + drizzle-kit, PGlite nos testes, React no painel, TS puro no player, Coolify 4.4.6).

**Spec:** Parte B de `/Users/deimac/.claude/plans/soft-whistling-mist.md` (fora do repositório; decisões copiadas abaixo). Identidade visual (logo, favicons, títulos "Kraken Ads") já entrou em `7394876`/`b95a777`.

## Decisões (2026-10-12)

- Nome do produto: **Kraken Ads**; prefixo de código: `kraken` (`@kraken/*`, `kraken_*`, `kraken-*`).
- "Planos Midora" → **"Planos Kraken"**: tabela `midora_plans` → `kraken_plans`, coluna `partners.midora_plan_id` → `kraken_plan_id`, rotas `/api/admin/midora-plans` → `/api/admin/kraken-plans`, campo JSON `midoraPlanId` → `krakenPlanId`, rota do painel `/admin/planos-midora` → `/admin/planos-kraken`.
- Paleta do painel/player: **mantém esmeralda/grafite** (sem mudança de cor nesta etapa).
- Infra (**feito pelo usuário em 2026-10-12**): repositório `deimac/kraken` (Coolify e `origin` atualizados; deploy pela fonte nova verificado às 15:01); no Coolify aplicação `kraken`, banco `kraken-db` (só rótulo: o banco interno é `postgres` e a `DATABASE_URL` usa o host por UUID), storage `kraken-media` em `/data/media` (volume novo; nenhuma mídia havia sido enviada, nada a copiar); domínio provisório `http://kraken.31.97.249.115.sslip.io` (o antigo `dincx9erqdqpi0tqapejhgqs.31.97.249.115.sslip.io` deixou de responder).
- **Sem camada de compatibilidade**: com a troca de domínio todos já precisam entrar de novo (cookies são por domínio) e não há TVs em uso, então cookies (`kraken_session`/`kraken_tv`), chaves (`kraken-theme`/`kraken-plays`) e rotas são trocados direto, sem aceitar os nomes antigos nem redirecionar `/admin/planos-midora`.
- Histórico preservado: planos `docs/superpowers/plans/2026-10-1[12]-etapa-*.md`, migrações SQL `0000`–`0004` e seus snapshots **não** são editados. Os arquivos-base são renomeados (`git mv`) e têm o conteúdo atualizado: `docs/ESPECIFICACAO_MVP_MIDORA.md`, `docs/PLANO_IMPLEMENTACAO_MVP_MIDORA.md`, `docs/PROMPT_INICIAL_CLAUDE_CODE_MIDORA.md`, `docs/superpowers/specs/2026-10-11-midora-mvp-design.md`; também `README.md` e `docs/DEPLOY.md`.

## Global Constraints

- Nenhuma linha do banco pode ser perdida (a migração renomeia, não recria).
- Pipeline verde antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- Textos visíveis em português; o nome do produto escrito sempre "Kraken Ads" (nunca só "Kraken" em texto corrido); "Planos Kraken"/"Plano Kraken" como nome da funcionalidade.

## Review Focus

1. **Migração 0005 aplicada sobre um banco com planos e parceiros vinculados** (o caso de produção) — linhas e vínculo `partners → kraken_plans` intactos, e o `drizzle-kit generate` não enxerga diferença depois. Teste na Task 2.
2. **Nome de cookie esquecido em algum ponto** (login, logout, renovação da TV no manifest, mídia lida pela TV) — todos usam as constantes; a varredura final da Task 5 garante que não sobrou `midora_session`/`midora_tv` literal.
3. **Imagem Docker e CI** — o `Dockerfile` filtra por nome de pacote; a imagem tem que buildar e o smoke test do CI passar com os nomes novos. Verificado nas Tasks 1 e 5.

---

### Task 1: Pacotes `@midora/*` → `@kraken/*`

**Files:**
- Modify: `package.json` (`"name": "midora"` → `"kraken"`, scripts `--filter @midora/...`)
- Modify: `apps/api/package.json`, `apps/web/package.json`, `apps/player/package.json`, `packages/shared/package.json`
- Modify: todo arquivo que importa `@midora/shared` (ex.: `apps/api/src/health.ts`), `apps/api/tsup.config.ts:8`, `Dockerfile:7`
- Modify: `pnpm-lock.yaml` (regerado)

**Interfaces:**
- Produces: pacotes `@kraken/api`, `@kraken/web`, `@kraken/player`, `@kraken/shared`; `pnpm --filter @kraken/api ...` passa a ser o comando de todas as tasks seguintes.

- [ ] **Step 1: Substituir o escopo fora do histórico**

```bash
git grep -l '@midora/' -- ':!docs/superpowers/plans' | xargs sed -i '' 's#@midora/#@kraken/#g'
sed -i '' 's/"name": "midora"/"name": "kraken"/' package.json
git grep -n '@midora/' -- ':!docs/superpowers/plans'
```
Expected: o último comando não imprime nada.

- [ ] **Step 2: Regerar o lockfile e os links do workspace**

Run: `pnpm install`
Expected: termina sem erro; `git diff --stat pnpm-lock.yaml` mostra só troca de nomes.

- [ ] **Step 3: Pipeline completo e imagem Docker**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && docker build -t kraken:local .`
Expected: tudo verde; a imagem builda (o `Dockerfile` usa `pnpm --filter @kraken/api deploy`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename workspace packages to @kraken/*"
```

---

### Task 2: Planos Kraken (banco, API e painel)

**Files:**
- Modify: `apps/api/src/db/schema.ts:14-39` (`midoraPlans` → `krakenPlans`, tabela `kraken_plans`, check `kraken_plans_price_check`, coluna `krakenPlanId: uuid('kraken_plan_id')`)
- Create: `apps/api/drizzle/0005_kraken_plans.sql` + `apps/api/drizzle/meta/0005_snapshot.json` + entrada no `_journal.json` (via `drizzle-kit generate --custom`)
- Move: `apps/api/src/midora-plans/routes.ts` → `apps/api/src/kraken-plans/routes.ts` (`krakenPlanRoutes`, rotas `/api/admin/kraken-plans`)
- Modify: `apps/api/src/app.ts:10,49`, `apps/api/src/partners/admin-routes.ts:8,31,68-69` (e qualquer outro uso de `midoraPlanId`/`midoraPlans` que o `tsc` apontar)
- Move: `apps/api/test/midora-plans.test.ts` → `apps/api/test/kraken-plans.test.ts`; Modify: `apps/api/test/partners.test.ts` (campo `krakenPlanId`)
- Create: `apps/api/test/migration-kraken-plans.test.ts`
- Modify: `apps/web/src/types.ts:10,13` (`krakenPlanId`, `KrakenPlan`)
- Move: `apps/web/src/pages/admin/MidoraPlans.tsx` → `KrakenPlans.tsx`; `apps/web/test/midora-plans.test.tsx` → `kraken-plans.test.tsx`
- Modify: `apps/web/src/App.tsx:4,28`, `apps/web/src/ui.tsx:14`, `apps/web/src/pages/admin/Partners.tsx:4,19,30,67,119-180`

**Interfaces:**
- Consumes: pacotes `@kraken/*` (Task 1).
- Produces: `krakenPlans` (tabela Drizzle), `partners.krakenPlanId`, `krakenPlanRoutes`, rotas `GET/POST /api/admin/kraken-plans`, `PATCH /api/admin/kraken-plans/:id`, tipo web `KrakenPlan { id; name; description; priceCents: number | null; active }`, rota do painel `/admin/planos-kraken`.

- [ ] **Step 1: Teste da migração com dados (falha)**

`apps/api/test/migration-kraken-plans.test.ts`:

```ts
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

const PLAN = '0190a000-0000-7000-8000-000000000001';

// Production already has plans and partners linked to them when 0005 runs.
it('0005 renames midora_plans to kraken_plans keeping rows and links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kraken-drizzle-'));
  await cp(fileURLToPath(new URL('../drizzle', import.meta.url)), dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const full = await readFile(journalPath, 'utf8');
  const journal = JSON.parse(full) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag < '0005');
  await writeFile(journalPath, JSON.stringify(journal));

  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: dir });
  await client.exec(`
    insert into midora_plans (id, name, price_cents) values ('${PLAN}', 'Essencial', 9900);
    insert into partners (name, slug, midora_plan_id) values ('A', 'a', '${PLAN}');
  `);

  await writeFile(journalPath, full);
  await migrate(db, { migrationsFolder: dir });
  const { rows } = await client.query(
    'select p.slug, k.name, k.price_cents from partners p join kraken_plans k on k.id = p.kraken_plan_id',
  );
  expect(rows).toEqual([{ slug: 'a', name: 'Essencial', price_cents: 9900 }]);
  await expect(client.exec(`insert into kraken_plans (name, price_cents) values ('X', -1)`)).rejects.toThrow();

  await client.close();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @kraken/api exec vitest run test/migration-kraken-plans.test.ts`
Expected: FAIL — `relation "kraken_plans" does not exist`.

- [ ] **Step 3: Renomear no schema**

Em `apps/api/src/db/schema.ts`:

```ts
export const krakenPlans = pgTable(
  'kraken_plans',
  {
    // colunas inalteradas
  },
  (t) => [check('kraken_plans_price_check', sql`${t.priceCents} is null or ${t.priceCents} >= 0`)],
);
```
e em `partners`:
```ts
    krakenPlanId: uuid('kraken_plan_id').references(() => krakenPlans.id, { onDelete: 'restrict' }),
```

- [ ] **Step 4: Gerar a migração customizada (snapshot = schema novo) e escrever o SQL**

Run: `pnpm --filter @kraken/api exec drizzle-kit generate --custom --name kraken_plans`
Expected: cria `apps/api/drizzle/0005_kraken_plans.sql` vazio, `meta/0005_snapshot.json` e a entrada `0005_kraken_plans` no `_journal.json`.

Conteúdo de `apps/api/drizzle/0005_kraken_plans.sql`:

```sql
-- Midora was renamed to Kraken Ads: rename in place, no data is copied or dropped.
ALTER TABLE "midora_plans" RENAME TO "kraken_plans";--> statement-breakpoint
ALTER INDEX "midora_plans_pkey" RENAME TO "kraken_plans_pkey";--> statement-breakpoint
ALTER TABLE "kraken_plans" RENAME CONSTRAINT "midora_plans_price_check" TO "kraken_plans_price_check";--> statement-breakpoint
ALTER TABLE "partners" RENAME COLUMN "midora_plan_id" TO "kraken_plan_id";--> statement-breakpoint
ALTER TABLE "partners" RENAME CONSTRAINT "partners_midora_plan_id_midora_plans_id_fk" TO "partners_kraken_plan_id_kraken_plans_id_fk";
```

- [ ] **Step 5: Confirmar que o snapshot bate com o schema**

Run: `pnpm --filter @kraken/api db:generate`
Expected: `No schema changes, nothing to migrate`. Se gerar um `0006`, apagar o arquivo/snapshot/entrada gerados e corrigir o SQL ou o schema até não haver diferença.

- [ ] **Step 6: Teste da migração passa**

Run: `pnpm --filter @kraken/api exec vitest run test/migration-kraken-plans.test.ts`
Expected: PASS.

- [ ] **Step 7: Renomear rotas e testes da API**

```bash
git mv apps/api/src/midora-plans apps/api/src/kraken-plans
git mv apps/api/test/midora-plans.test.ts apps/api/test/kraken-plans.test.ts
git grep -l -E 'midoraPlan|MidoraPlan|midora-plans|midora_plan' -- apps/api/src apps/api/test \
  | xargs sed -i '' -e 's/midoraPlanRoutes/krakenPlanRoutes/g' -e 's/midoraPlanId/krakenPlanId/g' \
    -e 's/midoraPlans/krakenPlans/g' -e 's#midora-plans#kraken-plans#g' -e 's/midora_plan_id/kraken_plan_id/g'
sed -i '' -e "s/describe('Midora plans'/describe('Kraken plans'/" apps/api/test/kraken-plans.test.ts
sed -i '' -e 's#// Plans Midora sells to partners#// Plans Kraken Ads sells to partners#' apps/api/src/kraken-plans/routes.ts
```
Run: `pnpm --filter @kraken/api typecheck && pnpm --filter @kraken/api test`
Expected: PASS (o `tsc` aponta qualquer uso restante de `midoraPlans`/`midoraPlanId`; corrigir até zerar).

- [ ] **Step 8: Teste do painel (falha)**

```bash
git mv apps/web/src/pages/admin/MidoraPlans.tsx apps/web/src/pages/admin/KrakenPlans.tsx
git mv apps/web/test/midora-plans.test.tsx apps/web/test/kraken-plans.test.tsx
```
Em `apps/web/test/kraken-plans.test.tsx`, trocar URLs `/api/admin/midora-plans` → `/api/admin/kraken-plans`, import `KrakenPlans` de `../src/pages/admin/KrakenPlans`, textos esperados "Planos Midora"/"Novo Plano Midora"/"Nenhum Plano Midora cadastrado." → "Planos Kraken"/"Novo Plano Kraken"/"Nenhum Plano Kraken cadastrado.".

Run: `pnpm --filter @kraken/web test`
Expected: FAIL (componente/textos/rota ainda antigos).

- [ ] **Step 9: Renomear no painel**

```bash
git grep -l -E 'midoraPlan|MidoraPlan|midora-plans|Planos? Midora|planos-midora' -- apps/web/src \
  | xargs sed -i '' -e 's/MidoraPlans/KrakenPlans/g' -e 's/MidoraPlan/KrakenPlan/g' -e 's/midoraPlanId/krakenPlanId/g' \
    -e 's#/api/admin/midora-plans#/api/admin/kraken-plans#g' -e 's/Planos Midora/Planos Kraken/g' \
    -e 's/Plano Midora/Plano Kraken/g' -e 's#planos-midora#planos-kraken#g'
sed -i '' 's/Planos que o Midora oferece aos parceiros/Planos que o Kraken Ads oferece aos parceiros/' apps/web/src/pages/admin/KrakenPlans.tsx
```
Run: `pnpm --filter @kraken/web typecheck && pnpm --filter @kraken/web test`
Expected: PASS.

- [ ] **Step 10: Pipeline e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: verde.

```bash
git add -A
git commit -m "feat: rename Midora plans to Kraken plans (table, API, panel)"
```

---

### Task 3: Cookies e chaves de `localStorage`

**Files:**
- Modify: `apps/api/src/auth/plugin.ts:13-15`
- Modify: `apps/web/src/theme.ts:2`, `apps/web/index.html:7`, `apps/web/test/theme.test.tsx`
- Modify: `apps/player/src/queue.ts:41`, `apps/player/test/queue.test.ts`
- Modify: testes da API que montam cookie à mão (`apps/api/test/helpers/fixtures.ts`, `auth.test.ts`, `campaigns.test.ts`, `hardening.test.ts`, `media-routes.test.ts`, `player-session.test.ts`, `player.test.ts`, `public.test.ts`)

**Interfaces:**
- Produces: `SESSION_COOKIE = 'kraken_session'`, `TV_COOKIE = 'kraken_tv'`; chaves `kraken-theme` e `kraken-plays`.

- [ ] **Step 1: Testes com os nomes novos (falham)**

```bash
git grep -l -E 'midora_session|midora_tv|midora-theme|midora-plays' -- apps/*/test \
  | xargs sed -i '' -e 's/midora_session/kraken_session/g' -e 's/midora_tv/kraken_tv/g' \
    -e 's/midora-theme/kraken-theme/g' -e 's/midora-plays/kraken-plays/g'
```
Run: `pnpm test`
Expected: FAIL nos testes de auth/player da API, no `theme.test.tsx` e no `queue.test.ts`.

- [ ] **Step 2: Trocar os nomes no código**

```bash
sed -i '' -e "s/'midora_session'/'kraken_session'/" -e "s/'midora_tv'/'kraken_tv'/" apps/api/src/auth/plugin.ts
sed -i '' "s/'midora-theme'/'kraken-theme'/" apps/web/src/theme.ts apps/web/index.html
sed -i '' "s/'midora-plays'/'kraken-plays'/" apps/player/src/queue.ts
```
Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: kraken cookie and localStorage names"
```

---

### Task 4: Textos, CI e documentação

**Files:**
- Modify: `apps/web/src/pages/partner/TvAccount.tsx:64`, `apps/web/src/pages/reports/Reports.tsx:76`, `apps/web/test/reports.test.tsx:22`
- Modify: `apps/api/src/reports/routes.ts:49` (+ teste do CSV em `apps/api/test/reports.test.ts` se esperar `Midora`), `apps/api/src/media/routes.ts:17`, `apps/api/src/auth/password.ts:18`
- Modify: `apps/api/scripts/demo.ts:41,72,110`, prefixos de diretório temporário e hosts em `apps/api/test/*` (`midora-app-`, `midora-media-`, `midora-static-`, `midora.test`, `Admin@Midora.com`, `----midora`)
- Modify: `.github/workflows/ci.yml:29-45`
- Move + Modify: `docs/ESPECIFICACAO_MVP_MIDORA.md` → `docs/ESPECIFICACAO_MVP_KRAKEN.md`; `docs/PLANO_IMPLEMENTACAO_MVP_MIDORA.md` → `docs/PLANO_IMPLEMENTACAO_MVP_KRAKEN.md`; `docs/PROMPT_INICIAL_CLAUDE_CODE_MIDORA.md` → `docs/PROMPT_INICIAL_CLAUDE_CODE_KRAKEN.md`; `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` → `docs/superpowers/specs/2026-10-11-kraken-ads-mvp-design.md`
- Modify: `README.md`, `docs/DEPLOY.md`, `docs/FIRE-TV.md` (se citar Midora)

**Interfaces:**
- Consumes: tudo das Tasks 1–3 (nomes finais de rotas, cookies, chaves).
- Produces: repositório sem `midora` fora da lista de exceções do Step 5.

- [ ] **Step 1: Teste de texto do relatório (falha)**

Em `apps/web/test/reports.test.tsx:22`: `/Kraken Ads · institucional/`. Se `apps/api/test/reports.test.ts` checar o nome do anunciante institucional no CSV, trocar o esperado para `Kraken Ads`.
Run: `pnpm --filter @kraken/web exec vitest run test/reports.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Textos e comentários do código**

```bash
sed -i '' "s/'Midora · institucional'/'Kraken Ads · institucional'/" apps/web/src/pages/reports/Reports.tsx
sed -i '' 's/no endereço do Midora seguido de/no endereço do Kraken Ads seguido de/' apps/web/src/pages/partner/TvAccount.tsx
sed -i '' "s/c.advertiserName ?? 'Midora'/c.advertiserName ?? 'Kraken Ads'/" apps/api/src/reports/routes.ts
sed -i '' 's/plus Midora institutional media/plus Kraken Ads institutional media/' apps/api/src/media/routes.ts
sed -i '' "s/hash('midora-dummy-password')/hash('kraken-dummy-password')/" apps/api/src/auth/password.ts
git grep -l -E "midora-(app|media|static|demo)-|midora\.test|Admin@Midora\.com|----midora|demo-midora-123|Midora demo em" -- apps \
  | xargs sed -i '' -e 's/midora-app-/kraken-app-/g' -e 's/midora-media-/kraken-media-/g' -e 's/midora-static-/kraken-static-/g' \
    -e 's/midora-demo-/kraken-demo-/g' -e 's/midora\.test/kraken.test/g' -e 's/Admin@Midora\.com/Admin@Kraken.com/g' \
    -e 's/----midora/----kraken/g' -e 's/demo-midora-123/demo-kraken-123/g' -e 's/Midora demo em/Kraken Ads demo em/g'
```
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: CI**

Em `.github/workflows/ci.yml`: imagem `kraken:ci`, rede `kraken-ci`, contêiner `kraken`, `POSTGRES_DB=kraken`, `DATABASE_URL=postgres://postgres:ci@db:5432/kraken`, `docker logs kraken`. A verificação `grep 'Kraken Ads Player'` fica.

- [ ] **Step 4: Documentação**

```bash
git mv docs/ESPECIFICACAO_MVP_MIDORA.md docs/ESPECIFICACAO_MVP_KRAKEN.md
git mv docs/PLANO_IMPLEMENTACAO_MVP_MIDORA.md docs/PLANO_IMPLEMENTACAO_MVP_KRAKEN.md
git mv docs/PROMPT_INICIAL_CLAUDE_CODE_MIDORA.md docs/PROMPT_INICIAL_CLAUDE_CODE_KRAKEN.md
git mv docs/superpowers/specs/2026-10-11-midora-mvp-design.md docs/superpowers/specs/2026-10-11-kraken-ads-mvp-design.md
```
Nos quatro arquivos, em `README.md` e `docs/FIRE-TV.md`: `MIDORA`/`Midora` → `Kraken Ads`, "Planos Midora"/"Plano Midora" → "Planos Kraken"/"Plano Kraken", nomes de arquivo `*_MIDORA.md` → `*_KRAKEN.md`, `midora-mvp-design` → `kraken-ads-mvp-design`, `midora_plans` → `kraken_plans`, `/api/admin/midora-plans` → `/api/admin/kraken-plans`. Revisar cada troca lendo o diff (não é só `sed`: frases como "o MIDORA" viram "o Kraken Ads"). No topo da spec, uma linha: `> Renomeado de Midora para Kraken Ads em 2026-10-12 (plano docs/superpowers/plans/2026-10-12-renomeacao-kraken-ads.md).`

`docs/DEPLOY.md`: título `# Kraken Ads — Implantação`; nomes atuais do Coolify (projeto/aplicação `kraken`, banco `kraken-db`, volume `kraken-media`), repositório `deimac/kraken`, domínio provisório `http://kraken.31.97.249.115.sslip.io`, "Logs: Coolify → kraken → Logs"; UUIDs inalterados.

- [ ] **Step 5: Varredura final**

Run:
```bash
git grep -n -i midora -- ':!docs/superpowers/plans/2026-10-1[12]-etapa-*' ':!apps/api/drizzle/000[0-4]_*' ':!apps/api/drizzle/meta/000[0-4]_snapshot.json' ':!docs/superpowers/plans/2026-10-12-renomeacao-kraken-ads.md'
```
Expected: só estes casos, todos intencionais: o SQL de `0005_kraken_plans.sql`, `meta/_journal.json` (tag `0002_midora_plans`), `migration-kraken-plans.test.ts` e a linha de histórico na spec. Qualquer outro resultado é corrigido.

- [ ] **Step 6: Pipeline, imagem e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && docker build -t kraken:local .`

```bash
git add -A
git commit -m "docs: rename Midora to Kraken Ads in texts, CI and documentation"
```

---

### Task 5: Revisão, merge e deploy do código

**Files:** nenhum novo (só verificação).

- [ ] **Step 1: Branch, PR, CI e revisão independente**

Push da branch `feat/kraken-rename`, abrir PR, CI verde, revisão de código independente (foco no **Review Focus**). Merge na `main` (autorizado após CI verde + revisão).

- [ ] **Step 2: Verificar produção** (`http://kraken.31.97.249.115.sslip.io`)

- `GET /api/health` → `version` = commit do merge (prova também o deploy automático pelo repositório `deimac/kraken`).
- Log da aplicação: migração `0005_kraken_plans` aplicada sem erro.
- Login no painel → cookie `kraken_session`; **Planos Kraken** abre em `/admin/planos-kraken`.
- Player em `/player/` → login da TV → cookie `kraken_tv`; envio de um vídeo, aprovação, exibição na TV e play contado em **Relatórios**.

---

### Task 6: Pendências de infraestrutura

Repositório, Coolify (nomes, fonte, storage) e domínio já foram feitos pelo usuário em 2026-10-12 (ver Decisões).

- [ ] **Step 1: Volume antigo** — `dincx9erqdqpi0tqapejhgqs-midora-media` não está mais em uso; o usuário pode removê-lo na VPS quando quiser (`docker volume rm dincx9erqdqpi0tqapejhgqs-midora-media`).
- [ ] **Step 2: Pasta local** (por último; encerra a sessão atual) — o usuário fecha o Claude Code e roda `mv ~/Projetos/midora ~/Projetos/kraken`; antes de abrir a sessão nova, copiar `~/.claude/projects/-Users-deimac-Projetos-midora/memory/` para `~/.claude/projects/-Users-deimac-Projetos-kraken/memory/`.

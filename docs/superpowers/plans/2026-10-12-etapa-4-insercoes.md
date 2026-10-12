# Etapa 4 — Contagem de inserções e relatórios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada anúncio exibido até o fim na TV vira uma inserção registrada uma única vez no servidor, mesmo com reenvios; parceiro, anunciante e admin veem relatórios de inserções por campanha e por dia (horário de Brasília), com exportação CSV.

**Architecture:** Tabela `plays` com o `id` gerado pelo player (UUIDv7) como chave primária — reenvio é `ON CONFLICT DO NOTHING`. O player registra o evento quando `present()` termina com `completed` (vídeo no `ended`, imagem após o tempo configurado), guarda numa fila persistida em `localStorage` e envia em lotes de até 200 a cada 30 s e ao voltar a rede; o servidor responde quais ids aceitou e quais rejeitou, e o player remove ambos da fila. Relatórios agregam direto em `plays`, por dia em `America/Sao_Paulo`.

**Tech Stack:** o atual (Fastify, Drizzle, PGlite nos testes, React no painel, TS puro no player).

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (§9 contagem; critérios 10, 11; Etapa 4)

## Global Constraints

- Inserção = evento técnico de reprodução concluída: vídeo no `ended`; imagem ao completar `displaySeconds`. Falha, erro, travamento ou interrupção não contam.
- Evento: `{ id: UUIDv7 do player, campaignId, mediaId, playedAt (relógio do player, ISO) }`. Servidor grava também `partnerId` (da sessão da TV), `mediaType` (do banco, não do cliente) e `receivedAt`.
- `POST /api/player/plays` (cookie da TV): lote de 1 a 200; resposta `{ accepted: string[], rejected: string[] }`; ids duplicados contam como aceitos e não duplicam.
- Validação por evento: a mídia pertence à campanha; a campanha é do parceiro da TV **ou** institucional; `playedAt` entre agora − 90 dias e agora + 5 min. Campanha que já terminou ou foi cancelada **é aceita** (a exibição aconteceu antes — cenário offline da Etapa 5).
- Inserção institucional é atribuída ao parceiro da TV que a exibiu.
- Relatórios: dias em `America/Sao_Paulo` (decisão do usuário, D11); período `from`/`to` inclusivo, máximo 366 dias. Escopo: admin tudo; parceiro = inserções nas TVs dele (comerciais e institucionais); anunciante = campanhas dele.
- CSV com `;` e BOM UTF-8 (abre direto no Excel em português).
- Fila do player em `localStorage['midora-plays']`, limite 50 000 eventos (descarta os mais antigos); envio a cada 30 s, no evento `online` e quando a fila passa de 50.
- UUIDv7 sem `BigInt`/`crypto.randomUUID` (navegadores de TV antigos); `crypto.getRandomValues` com fallback.
- Migração nova só aditiva (`0004_*`).
- Branch `feat/etapa-4-insercoes`; Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; merge autorizado após CI + revisão.
- **Decisões desta etapa:** (a) fila em `localStorage` agora; a Etapa 5 decide se migra para IndexedDB junto com o cache de mídia; (b) relatório por `playedAt` (relógio da TV), com `receivedAt` guardado para auditoria; (c) sem tabela de totais pré-calculados enquanto o volume não exigir.

## Review Focus

1. O mesmo lote enviado duas vezes (rede caiu depois do servidor gravar) não pode dobrar a contagem — teste na Task 1.
2. TV de um parceiro enviando inserção de campanha de outro parceiro → rejeitada, nunca contada — teste na Task 1.
3. Anúncio interrompido (vídeo travou, erro) não gera inserção — teste na Task 3.
4. TV reinicia com eventos pendentes: eles continuam na fila e são enviados depois — teste na Task 3.
5. Inserção às 23:30 de Brasília aparece no dia certo (não no dia seguinte em UTC) — teste na Task 2.
6. Anunciante não vê inserções de outro anunciante nem de institucionais — teste na Task 2.

---

## Estrutura de arquivos

```
apps/api/src/db/schema.ts          (mod) tabela plays
apps/api/src/plays/routes.ts       POST /api/player/plays
apps/api/src/reports/routes.ts     GET /api/reports/plays e /api/reports/plays.csv
apps/api/src/reports/query.ts      playsReport(db, scope, range)
apps/api/test/plays.test.ts  apps/api/test/reports.test.ts
apps/player/src/uuid.ts            uuidv7
apps/player/src/queue.ts           fila persistida com envio em lotes
apps/player/src/main.ts            (mod) liga onPlayed → fila → envio
apps/player/test/uuid.test.ts  apps/player/test/queue.test.ts
apps/web/src/pages/reports/Reports.tsx
apps/web/src/ui.tsx  apps/web/src/App.tsx  apps/web/src/types.ts  (mod)
apps/web/test/reports.test.tsx
docs/superpowers/specs/2026-10-11-midora-mvp-design.md  (mod) D11
```

---

### Task 1: Registro idempotente de inserções

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/app.ts`, `apps/api/test/guard.test.ts`, `docs/superpowers/specs/2026-10-11-midora-mvp-design.md`
- Create: `apps/api/src/plays/routes.ts`, `apps/api/test/plays.test.ts`, `apps/api/drizzle/0004_*.sql` (gerado)

**Interfaces:**
- Produces: tabela `plays` (`id`, `campaignId`, `partnerId`, `mediaId`, `mediaType`, `playedAt`, `receivedAt`); `POST /api/player/plays` `{ plays: { id, campaignId, mediaId, playedAt }[] }` → `{ accepted, rejected }`; `playRoutes: FastifyPluginAsync<{ db: Db }>`.

- [ ] **Step 1: Branch e decisão na especificação**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-4-insercoes
```
Na tabela de decisões da especificação, acrescentar:
```markdown
| D11 | Relatórios por dia no horário de Brasília (`America/Sao_Paulo`), para todos os parceiros. |
```

- [ ] **Step 2: Testes que falham**

`apps/api/test/plays.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partners, plays } from '../src/db/schema';
import { createTestApp, multipart, seed } from './helpers/app';
import { loginTv } from './helpers/fixtures';
import { PNG_BYTES } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let tvA: string;
let tvB: string;
let campA: { id: string; media: string };
let campB: { id: string; media: string };
let inst: { id: string; media: string };

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

async function approvedCampaign(cookie: string, name: string) {
  const plan = (await req('POST', '/api/partner/plans', cookie, { name: `P ${name}`, frequencyLevel: 'low' })).json().plan.id;
  const adv = (await req('POST', '/api/partner/advertisers', cookie, { name: `A ${name}` })).json().advertiser.id;
  const id = (await req('POST', '/api/campaigns', cookie, {
    advertiserId: adv, planId: plan, name, startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  const media = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/media`, headers: { cookie, ...m.headers }, payload: m.payload })).json().media.id;
  await req('POST', `/api/campaigns/${id}/submit`, cookie);
  await req('POST', `/api/campaigns/${id}/approve`, cookie);
  return { id, media };
}

const play = (c: { id: string; media: string }, id: string, playedAt = new Date().toISOString()) => ({
  id, campaignId: c.id, mediaId: c.media, playedAt,
});
const ID = (n: number) => `0190f000-0000-7000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  campA = await approvedCampaign(s.gerenteA, 'A1');
  campB = await approvedCampaign(s.gerenteB, 'B1');
  const ic = (await req('POST', '/api/admin/campaigns', s.admin, {
    name: 'Inst', frequencyLevel: 'low', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const m = multipart({ filename: 'i.png', contentType: 'image/png', data: PNG_BYTES });
  inst = { id: ic, media: (await t.app.inject({ method: 'POST', url: `/api/admin/campaigns/${ic}/media`, headers: { cookie: s.admin, ...m.headers }, payload: m.payload })).json().media.id };
  await t.db.update(partners).set({ showInstitutional: true }).where(eq(partners.id, s.partnerA.id));
  await req('PUT', '/api/partner/player-account', s.gerenteA, { password: 'senha-tv-123' });
  await req('PUT', '/api/partner/player-account', s.gerenteB, { password: 'senha-tv-456' });
  tvA = await loginTv(t.app, 'tv@parceiro-a', 'senha-tv-123');
  tvB = await loginTv(t.app, 'tv@parceiro-b', 'senha-tv-456');
});
afterAll(() => t.close());

describe('POST /api/player/plays', () => {
  it('records plays once even when the same batch is sent twice', async () => {
    const batch = { plays: [play(campA, ID(1)), play(campA, ID(2))] };
    const first = await req('POST', '/api/player/plays', tvA, batch);
    expect(first.json()).toEqual({ accepted: [ID(1), ID(2)], rejected: [] });
    const again = await req('POST', '/api/player/plays', tvA, batch);
    expect(again.json()).toEqual({ accepted: [ID(1), ID(2)], rejected: [] });
    const rows = await t.db.select().from(plays).where(eq(plays.campaignId, campA.id));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ partnerId: s.partnerA.id, mediaType: 'image' });
  });

  it("rejects another partner's campaign and mismatched media", async () => {
    const res = await req('POST', '/api/player/plays', tvA, {
      plays: [play(campB, ID(10)), { ...play(campA, ID(11)), mediaId: campB.media }],
    });
    expect(res.json()).toEqual({ accepted: [], rejected: [ID(10), ID(11)] });
  });

  it('attributes institutional plays to the partner whose TV showed them', async () => {
    expect((await req('POST', '/api/player/plays', tvA, { plays: [play(inst, ID(20))] })).json().accepted).toEqual([ID(20)]);
    const [row] = await t.db.select().from(plays).where(eq(plays.id, ID(20)));
    expect(row!.partnerId).toBe(s.partnerA.id);
  });

  it('accepts plays of a campaign cancelled after they happened', async () => {
    const c = await approvedCampaign(s.gerenteB, 'B2');
    await req('POST', `/api/campaigns/${c.id}/cancel`, s.gerenteB);
    expect((await req('POST', '/api/player/plays', tvB, { plays: [play(c, ID(30))] })).json().accepted).toEqual([ID(30)]);
  });

  it('rejects implausible clocks and invalid batches', async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const ancient = new Date(Date.now() - 100 * 86_400_000).toISOString();
    expect((await req('POST', '/api/player/plays', tvA, { plays: [play(campA, ID(40), future), play(campA, ID(41), ancient)] })).json())
      .toEqual({ accepted: [], rejected: [ID(40), ID(41)] });
    expect((await req('POST', '/api/player/plays', tvA, { plays: [] })).statusCode).toBe(400);
    const tooMany = { plays: Array.from({ length: 201 }, (_, i) => play(campA, ID(1000 + i))) };
    expect((await req('POST', '/api/player/plays', tvA, tooMany)).statusCode).toBe(400);
    expect((await req('POST', '/api/player/plays', tvA, { plays: [{ ...play(campA, 'not-a-uuid') }] })).statusCode).toBe(400);
  });

  it('is only for TVs', async () => {
    expect((await req('POST', '/api/player/plays', s.gerenteA, { plays: [play(campA, ID(50))] })).statusCode).toBe(401);
  });
});
```

`apps/api/test/guard.test.ts`: acrescentar `['POST', '/api/player/plays']`.

Run: `pnpm --filter @midora/api test -- plays guard`
Expected: FAIL (`plays` não existe; rota 404).

- [ ] **Step 3: Schema e migração**

`apps/api/src/db/schema.ts`, no fim:
```ts
export const plays = pgTable(
  'plays',
  {
    id: uuid('id').primaryKey(), // generated by the player (UUIDv7): makes resends idempotent
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'restrict' }),
    mediaType: text('media_type', { enum: ['image', 'video'] }).notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('plays_media_type_check', sql`${t.mediaType} in ('image', 'video')`),
    index('plays_campaign_played_idx').on(t.campaignId, t.playedAt),
    index('plays_partner_played_idx').on(t.partnerId, t.playedAt),
  ],
);
```
Run: `pnpm --filter @midora/api db:generate --name plays` → `0004_plays.sql` sem `DROP`.

- [ ] **Step 4: Rota**

`apps/api/src/plays/routes.ts`:
```ts
import { eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { campaigns, media, plays } from '../db/schema';
import { parse } from '../http/validation';

const MAX_AGE_MS = 90 * 86_400_000;
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

const Batch = z
  .object({
    plays: z
      .array(
        z
          .object({ id: z.uuid(), campaignId: z.uuid(), mediaId: z.uuid(), playedAt: z.iso.datetime({ offset: true }) })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const playRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post('/api/player/plays', { preHandler: requireRole('player') }, async (req, reply) => {
    const body = parse(Batch, req.body, reply);
    if (!body) return reply;
    const partnerId = req.user!.partnerId!;
    const mediaIds = [...new Set(body.plays.map((p) => p.mediaId))];
    const known = await db
      .select({ id: media.id, campaignId: media.campaignId, mediaType: media.mediaType, owner: campaigns.partnerId, kind: campaigns.kind })
      .from(media)
      .innerJoin(campaigns, eq(campaigns.id, media.campaignId))
      .where(inArray(media.id, mediaIds));
    const byId = new Map(known.map((m) => [m.id, m]));
    const now = Date.now();

    const accepted: string[] = [];
    const rejected: string[] = [];
    const rows: (typeof plays.$inferInsert)[] = [];
    for (const p of body.plays) {
      const m = byId.get(p.mediaId);
      const at = new Date(p.playedAt).getTime();
      const ok =
        m !== undefined &&
        m.campaignId === p.campaignId &&
        (m.owner === partnerId || m.kind === 'institutional') &&
        at >= now - MAX_AGE_MS &&
        at <= now + MAX_CLOCK_AHEAD_MS;
      if (!ok) {
        rejected.push(p.id);
        continue;
      }
      accepted.push(p.id);
      rows.push({ id: p.id, campaignId: p.campaignId, partnerId, mediaId: p.mediaId, mediaType: m.mediaType, playedAt: new Date(at) });
    }
    // Resends are expected (TV lost the response): duplicates are silently kept once.
    if (rows.length) await db.insert(plays).values(rows).onConflictDoNothing({ target: plays.id });
    return { accepted, rejected };
  });
};
```
`apps/api/src/app.ts`: registrar `playRoutes` (`{ db: opts.db }`) junto de `playerRoutes`. A rota está sob `/api/player/`, então usa o cookie da TV.

- [ ] **Step 5: Rodar e commit**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add apps/api docs/superpowers/specs
git commit -m "feat(api): record TV plays idempotently with partner scoping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Relatório de inserções (JSON e CSV)

**Files:**
- Create: `apps/api/src/reports/query.ts`, `apps/api/src/reports/routes.ts`, `apps/api/test/reports.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/test/guard.test.ts`

**Interfaces:**
- Produces:
  - `type ReportScope = { kind: 'all' } | { kind: 'partner'; partnerId: string } | { kind: 'advertiser'; advertiserId: string }`
  - `interface ReportRow { campaignId: string; name: string; kind: 'commercial' | 'institutional'; advertiserName: string | null; total: number; days: { day: string; count: number }[] }`
  - `playsReport(db, scope, range: { from: string; to: string }): Promise<ReportRow[]>` (`from`/`to` = `YYYY-MM-DD`, inclusivos, Brasília)
  - `GET /api/reports/plays?from&to` → `{ from, to, campaigns: ReportRow[] }`; `GET /api/reports/plays.csv?from&to` → `text/csv` com `campanha;anunciante;tipo;dia;insercoes`
  - Erros: período inválido/invertido/maior que 366 dias → 400 `invalid_request`

- [ ] **Step 1: Teste que falha**

`apps/api/test/reports.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advertisers, campaigns, media, plays, plans } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';
import { createUser, login } from './helpers/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let advCookie: string;

const req = (url: string, cookie?: string) => t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

async function campaign(partnerId: string | null, name: string, advertiserId: string | null) {
  let planId: string | null = null;
  if (partnerId) planId = (await t.db.insert(plans).values({ partnerId, name: 'P', frequencyLevel: 'low' }).returning())[0]!.id;
  const [c] = await t.db.insert(campaigns).values({
    kind: partnerId ? 'commercial' : 'institutional', partnerId, advertiserId, planId, name, status: 'approved',
    frequencyLevel: 'low', startsAt: new Date('2026-01-01'), endsAt: new Date('2030-01-01'),
  }).returning();
  const [m] = await t.db.insert(media).values({
    partnerId, campaignId: c!.id, storageKey: `k/${c!.id}`, mediaType: 'image', mime: 'image/png', sizeBytes: 1, sha256: 's', displaySeconds: 10,
  }).returning();
  return { id: c!.id, media: m!.id };
}

let n = 0;
async function record(c: { id: string; media: string }, partnerId: string, playedAt: string, count = 1) {
  const rows = Array.from({ length: count }, () => ({
    id: `0190f000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    campaignId: c.id, partnerId, mediaId: c.media, mediaType: 'image' as const, playedAt: new Date(playedAt),
  }));
  await t.db.insert(plays).values(rows);
}

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  const [advA] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Loja A', source: 'manual' }).returning();
  const [advA2] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Loja A2', source: 'manual' }).returning();
  const [advB] = await t.db.insert(advertisers).values({ partnerId: s.partnerB.id, name: 'Loja B', source: 'manual' }).returning();
  const a = await campaign(s.partnerA.id, 'Campanha A', advA!.id);
  const a2 = await campaign(s.partnerA.id, 'Campanha A2', advA2!.id);
  const b = await campaign(s.partnerB.id, 'Campanha B', advB!.id);
  const inst = await campaign(null, 'Institucional', null);
  await record(a, s.partnerA.id, '2026-10-10T15:00:00Z', 3);
  await record(a, s.partnerA.id, '2026-10-11T02:30:00Z', 2); // 23:30 on 10/10 in Brasília
  await record(a, s.partnerA.id, '2026-10-12T12:00:00Z', 4);
  await record(a2, s.partnerA.id, '2026-10-11T12:00:00Z', 1);
  await record(b, s.partnerB.id, '2026-10-11T12:00:00Z', 7);
  await record(inst, s.partnerA.id, '2026-10-11T12:00:00Z', 5);
  await record(a, s.partnerA.id, '2026-09-01T12:00:00Z', 9); // outside the range
  await createUser(t.db, { email: 'adv@a.com', password: 'senha-forte-1', role: 'advertiser', partnerId: s.partnerA.id, advertiserId: advA!.id });
  advCookie = await login(t.app, 'adv@a.com', 'senha-forte-1');
});
afterAll(() => t.close());

const RANGE = 'from=2026-10-10&to=2026-10-12';
const names = (body: { campaigns: { name: string }[] }) => body.campaigns.map((c) => c.name).sort();

describe('plays report', () => {
  it('groups by campaign and Brasília day', async () => {
    const body = (await req(`/api/reports/plays?${RANGE}`, s.gerenteA)).json();
    const a = body.campaigns.find((c: { name: string }) => c.name === 'Campanha A');
    expect(a).toMatchObject({ total: 9, advertiserName: 'Loja A', kind: 'commercial' });
    expect(a.days).toEqual([
      { day: '2026-10-10', count: 5 },
      { day: '2026-10-12', count: 4 },
    ]);
  });

  it('scopes partners to their screens (including institutional)', async () => {
    expect(names((await req(`/api/reports/plays?${RANGE}`, s.gerenteA)).json())).toEqual(['Campanha A', 'Campanha A2', 'Institucional']);
    expect(names((await req(`/api/reports/plays?${RANGE}`, s.gerenteB)).json())).toEqual(['Campanha B']);
  });

  it('scopes advertisers to their own campaigns', async () => {
    expect(names((await req(`/api/reports/plays?${RANGE}`, advCookie)).json())).toEqual(['Campanha A']);
  });

  it('shows everything to the admin', async () => {
    expect(names((await req(`/api/reports/plays?${RANGE}`, s.admin)).json())).toEqual(['Campanha A', 'Campanha A2', 'Campanha B', 'Institucional']);
  });

  it('validates the period', async () => {
    expect((await req('/api/reports/plays?from=2026-10-12&to=2026-10-10', s.gerenteA)).statusCode).toBe(400);
    expect((await req('/api/reports/plays?from=2024-01-01&to=2026-01-01', s.gerenteA)).statusCode).toBe(400);
    expect((await req('/api/reports/plays?from=ontem&to=hoje', s.gerenteA)).statusCode).toBe(400);
    expect((await req(`/api/reports/plays?${RANGE}`)).statusCode).toBe(401);
  });

  it('exports CSV for Excel', async () => {
    const res = await req(`/api/reports/plays.csv?${RANGE}`, advCookie);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('insercoes-2026-10-10-a-2026-10-12.csv');
    const lines = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('campanha;anunciante;tipo;dia;insercoes');
    expect(lines).toContain('Campanha A;Loja A;comercial;2026-10-10;5');
  });
});
```

`apps/api/test/guard.test.ts`: acrescentar `['GET', '/api/reports/plays?from=2026-10-01&to=2026-10-02']` e `['GET', '/api/reports/plays.csv?from=2026-10-01&to=2026-10-02']`.

Run: `pnpm --filter @midora/api test -- reports guard`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/api/src/reports/query.ts`:
```ts
import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { advertisers, campaigns, plays } from '../db/schema';

export const REPORT_TZ = 'America/Sao_Paulo';

export type ReportScope =
  | { kind: 'all' }
  | { kind: 'partner'; partnerId: string }
  | { kind: 'advertiser'; advertiserId: string };

export interface ReportRow {
  campaignId: string;
  name: string;
  kind: 'commercial' | 'institutional';
  advertiserName: string | null;
  total: number;
  days: { day: string; count: number }[];
}

/** Brasília has no DST since 2019, so a fixed -03:00 offset bounds the day range exactly. */
function bounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(`${to}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function playsReport(db: Db, scope: ReportScope, range: { from: string; to: string }): Promise<ReportRow[]> {
  const { start, end } = bounds(range.from, range.to);
  const day = sql<string>`to_char(${plays.playedAt} at time zone ${sql.raw(`'${REPORT_TZ}'`)}, 'YYYY-MM-DD')`;
  const filters: SQL[] = [gte(plays.playedAt, start), lt(plays.playedAt, end)];
  if (scope.kind === 'partner') filters.push(eq(plays.partnerId, scope.partnerId));
  if (scope.kind === 'advertiser') filters.push(eq(campaigns.advertiserId, scope.advertiserId));

  const rows = await db
    .select({
      campaignId: campaigns.id,
      name: campaigns.name,
      kind: campaigns.kind,
      advertiserName: advertisers.name,
      day,
      count: sql<number>`count(*)::int`,
    })
    .from(plays)
    .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
    .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
    .where(and(...filters))
    .groupBy(campaigns.id, campaigns.name, campaigns.kind, advertisers.name, day)
    .orderBy(asc(campaigns.name), asc(day));

  const out = new Map<string, ReportRow>();
  for (const r of rows) {
    let row = out.get(r.campaignId);
    if (!row) {
      row = { campaignId: r.campaignId, name: r.name, kind: r.kind, advertiserName: r.advertiserName, total: 0, days: [] };
      out.set(r.campaignId, row);
    }
    row.total += r.count;
    row.days.push({ day: r.day, count: r.count });
  }
  return [...out.values()];
}
```

`apps/api/src/reports/routes.ts`:
```ts
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { parse } from '../http/validation';
import { playsReport, type ReportScope } from './query';

const MAX_DAYS = 366;
const Range = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, 'to must not be before from')
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 < MAX_DAYS, 'period too long');

function scopeFor(req: FastifyRequest): ReportScope {
  const u = req.user!;
  if (u.role === 'partner_user') return { kind: 'partner', partnerId: u.partnerId! };
  if (u.role === 'advertiser') return { kind: 'advertiser', advertiserId: u.advertiserId! };
  return { kind: 'all' };
}

const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const reportRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const guard = { preHandler: requireRole('admin', 'partner_user', 'advertiser') };

  const load = async (req: FastifyRequest, reply: FastifyReply) => {
    const range = parse(Range, req.query, reply);
    if (!range) return null;
    return { range, campaigns: await playsReport(db, scopeFor(req), range) };
  };

  app.get('/api/reports/plays', guard, async (req, reply) => {
    const r = await load(req, reply);
    if (!r) return reply;
    return { from: r.range.from, to: r.range.to, campaigns: r.campaigns };
  });

  app.get('/api/reports/plays.csv', guard, async (req, reply) => {
    const r = await load(req, reply);
    if (!r) return reply;
    const lines = ['campanha;anunciante;tipo;dia;insercoes'];
    for (const c of r.campaigns) {
      for (const d of c.days) {
        const kind = c.kind === 'institutional' ? 'institucional' : 'comercial';
        lines.push([c.name, c.advertiserName ?? 'Midora', kind, d.day, String(d.count)].map(csvCell).join(';'));
      }
    }
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="insercoes-${r.range.from}-a-${r.range.to}.csv"`);
    return `﻿${lines.join('\r\n')}\r\n`;
  });
};
```
`apps/api/src/app.ts`: registrar `reportRoutes` (`{ db: opts.db }`).

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: PASS. Se o PGlite não tiver a base de fusos e o teste do dia 10/10 falhar, trocar a expressão do dia por `to_char((${plays.playedAt} at time zone 'UTC') - interval '3 hours', 'YYYY-MM-DD')` (Brasília não tem horário de verão desde 2019) e registrar a escolha no ledger.
```bash
git add apps/api
git commit -m "feat(api): add plays report by campaign and Brasília day with CSV export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fila de inserções no player

**Files:**
- Create: `apps/player/src/uuid.ts`, `apps/player/src/queue.ts`, `apps/player/test/uuid.test.ts`, `apps/player/test/queue.test.ts`
- Modify: `apps/player/src/main.ts`, `apps/player/test/player.test.ts`

**Interfaces:**
- Produces:
  - `uuidv7(now?: number, random?: (n: number) => Uint8Array): string`
  - `interface PlayEvent { id: string; campaignId: string; mediaId: string; playedAt: string }`
  - `createPlayQueue(opts: { send(batch: PlayEvent[]): Promise<{ accepted: string[]; rejected: string[] }>; storage?: Pick<Storage, 'getItem' | 'setItem'> | null; key?: string; max?: number; batchSize?: number }): { add(e: PlayEvent): void; flush(): Promise<boolean>; size(): number }`
  - `playEvent(item: Item, now?: Date): PlayEvent`

- [ ] **Step 1: Testes que falham**

`apps/player/test/uuid.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/uuid';

describe('uuidv7', () => {
  it('is a version 7, variant 10 UUID with the timestamp first', () => {
    const id = uuidv7(0x0190f0123456, (n) => new Uint8Array(n).fill(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.startsWith('0190f012-3456-7')).toBe(true);
  });

  it('sorts by time and does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});
```

`apps/player/test/queue.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createPlayQueue, playEvent, type PlayEvent } from '../src/queue';
import type { Item } from '../src/types';

const ev = (n: number): PlayEvent => ({ id: `id-${n}`, campaignId: 'c', mediaId: 'm', playedAt: '2026-10-12T12:00:00.000Z' });

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('play queue', () => {
  it('survives a restart through storage', () => {
    const storage = memoryStorage();
    const q1 = createPlayQueue({ send: vi.fn(), storage });
    q1.add(ev(1));
    q1.add(ev(2));
    const q2 = createPlayQueue({ send: vi.fn(), storage });
    expect(q2.size()).toBe(2);
  });

  it('sends in batches and drops accepted and rejected ids', async () => {
    const send = vi.fn(async (batch: PlayEvent[]) => ({
      accepted: batch.filter((e) => e.id !== 'id-3').map((e) => e.id),
      rejected: batch.filter((e) => e.id === 'id-3').map((e) => e.id),
    }));
    const q = createPlayQueue({ send, storage: memoryStorage(), batchSize: 2 });
    for (let i = 1; i <= 5; i++) q.add(ev(i));
    expect(await q.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![0].map((e) => e.id)).toEqual(['id-1', 'id-2']);
    expect(q.size()).toBe(0);
  });

  it('keeps everything when the network fails', async () => {
    const q = createPlayQueue({ send: vi.fn(async () => { throw new TypeError('offline'); }), storage: memoryStorage() });
    q.add(ev(1));
    expect(await q.flush()).toBe(false);
    expect(q.size()).toBe(1);
  });

  it('never runs two flushes at once', async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<{ accepted: string[]; rejected: string[] }>((r) => { release = () => r({ accepted: ['id-1'], rejected: [] }); }));
    const q = createPlayQueue({ send, storage: memoryStorage() });
    q.add(ev(1));
    const a = q.flush();
    const b = q.flush();
    release();
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps the backlog, dropping the oldest', () => {
    const q = createPlayQueue({ send: vi.fn(), storage: memoryStorage(), max: 3 });
    for (let i = 1; i <= 5; i++) q.add(ev(i));
    expect(q.size()).toBe(3);
  });

  it('works without storage', () => {
    const q = createPlayQueue({ send: vi.fn(), storage: null });
    q.add(ev(1));
    expect(q.size()).toBe(1);
  });

  it('builds an event from a played item', () => {
    const item = { campaignId: 'c1', media: { id: 'm1' } } as Item;
    const e = playEvent(item, new Date('2026-10-12T15:00:00Z'));
    expect(e).toMatchObject({ campaignId: 'c1', mediaId: 'm1', playedAt: '2026-10-12T15:00:00.000Z' });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

`apps/player/test/player.test.ts`, novo teste em `describe('runPlayer')`:
```ts
  it('reports only completed plays', async () => {
    const screen = new FakeScreen();
    screen.results = ['completed', 'failed', 'completed'];
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => manifest([item('A'), item('B')]), sleep: async () => {}, running: until(3),
      onPlayed: (i, result) => { if (result === 'completed') played.push(i.campaignId); },
    });
    expect(played).toHaveLength(2);
  });
```
(Este teste documenta o contrato: `main.ts` só enfileira quando `result === 'completed'`.)

Run: `pnpm --filter @midora/player test`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: Implementação**

`apps/player/src/uuid.ts`:
```ts
function randomBytes(n: number): Uint8Array {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint8Array(n));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** RFC 9562 UUIDv7 (time-ordered) without BigInt or crypto.randomUUID, for old TV browsers. */
export function uuidv7(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  const b = random(16);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  const hex = Array.prototype.map.call(b, (x: number) => (x + 0x100).toString(16).slice(1)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`apps/player/src/queue.ts`:
```ts
import type { Item } from './types';
import { uuidv7 } from './uuid';

export interface PlayEvent {
  id: string;
  campaignId: string;
  mediaId: string;
  playedAt: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function playEvent(item: Item, now: Date = new Date()): PlayEvent {
  return { id: uuidv7(now.getTime()), campaignId: item.campaignId, mediaId: item.media.id, playedAt: now.toISOString() };
}

/** Plays waiting to reach the server; survives reloads so no completed play is lost. */
export function createPlayQueue(opts: {
  send(batch: PlayEvent[]): Promise<{ accepted: string[]; rejected: string[] }>;
  storage?: Store | null;
  key?: string;
  max?: number;
  batchSize?: number;
}) {
  const key = opts.key ?? 'midora-plays';
  const max = opts.max ?? 50_000;
  const batchSize = opts.batchSize ?? 200;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  let queue: PlayEvent[] = load();
  let flushing: Promise<boolean> | null = null;

  function load(): PlayEvent[] {
    try {
      const raw = storage?.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as PlayEvent[]) : [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      storage?.setItem(key, JSON.stringify(queue));
    } catch {
      /* storage full or blocked: keep in memory */
    }
  }

  async function run(): Promise<boolean> {
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, batchSize);
        const res = await opts.send(batch);
        const done = new Set([...res.accepted, ...res.rejected]);
        const before = queue.length;
        queue = queue.filter((e) => !done.has(e.id));
        persist();
        if (queue.length === before) break; // server answered nothing about this batch
      }
      return true;
    } catch {
      return false; // offline or server error: try again later
    }
  }

  return {
    add(e: PlayEvent) {
      queue.push(e);
      if (queue.length > max) queue = queue.slice(queue.length - max);
      persist();
    },
    flush(): Promise<boolean> {
      if (!flushing) flushing = run().finally(() => (flushing = null));
      return flushing;
    },
    size: () => queue.length,
  };
}

function defaultStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
```

`apps/player/src/main.ts`, em `start()`:
```ts
  const plays = createPlayQueue({
    send: (batch) => api<{ accepted: string[]; rejected: string[] }>('/api/player/plays', { method: 'POST', body: { plays: batch } }),
  });
  const flush = () => void plays.flush();
  setInterval(flush, 30_000);
  window.addEventListener('online', flush);
  flush(); // plays left from before a restart
```
e no `runPlayer`:
```ts
    onPlayed: (item, result) => {
      if (result !== 'completed') return;
      plays.add(playEvent(item));
      if (plays.size() >= 50) flush();
    },
```
(imports `createPlayQueue`, `playEvent` de `./queue`). Um 401 no envio é tratado pelo manifesto, que recarrega a página na próxima consulta.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/player test && pnpm --filter @midora/player typecheck && pnpm lint && pnpm --filter @midora/player build`
Expected: PASS; bundle moderno ≤ 25 KB gzip.
```bash
git add apps/player
git commit -m "feat(player): queue completed plays and send them in idempotent batches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tela de relatórios no painel

**Files:**
- Create: `apps/web/src/pages/reports/Reports.tsx`, `apps/web/test/reports.test.tsx`
- Modify: `apps/web/src/ui.tsx`, `apps/web/src/App.tsx`, `apps/web/src/types.ts`

**Interfaces:**
- Produces: rotas `/admin/relatorios`, `/parceiro/relatorios`, `/anunciante/relatorios`; item de menu "Relatórios" nas três áreas; tipo `ReportCampaign`.

- [ ] **Step 1: Teste que falha**

`apps/web/test/reports.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const report = {
  from: '2026-10-01', to: '2026-10-12',
  campaigns: [
    { campaignId: 'c1', name: 'Verão', kind: 'commercial', advertiserName: 'Loja Fit', total: 120, days: [{ day: '2026-10-10', count: 50 }, { day: '2026-10-11', count: 70 }] },
    { campaignId: 'c2', name: 'Anuncie aqui', kind: 'institutional', advertiserName: null, total: 30, days: [{ day: '2026-10-11', count: 30 }] },
  ],
};

describe('reports', () => {
  it('shows totals, expands days and links the CSV for the chosen period', async () => {
    const calls = mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/reports/plays': report });
    renderAt('/parceiro/relatorios');
    expect(await screen.findByText('Verão')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('Total no período: 150 inserções')).toBeTruthy();
    expect(screen.getByText(/Midora · institucional/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver dias de Verão' }));
    expect(screen.getByText('11/10/2026')).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();

    await userEvent.clear(screen.getByLabelText('De'));
    await userEvent.type(screen.getByLabelText('De'), '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(calls.some((c) => c.path.startsWith('/api/reports/plays?from=2026-09-01&to='))).toBe(true);
    const csv = screen.getByRole('link', { name: 'Baixar CSV' }) as HTMLAnchorElement;
    expect(csv.getAttribute('href')).toMatch(/^\/api\/reports\/plays\.csv\?from=2026-09-01&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('is available to advertisers and explains an empty period', async () => {
    mockApi({ 'GET /api/auth/me': { user: advertiserUser }, 'GET /api/reports/plays': { from: 'x', to: 'y', campaigns: [] } });
    renderAt('/anunciante/relatorios');
    expect(await screen.findByText('Nenhuma inserção no período.')).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- reports`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/types.ts`:
```ts
export interface ReportCampaign {
  campaignId: string;
  name: string;
  kind: 'commercial' | 'institutional';
  advertiserName: string | null;
  total: number;
  days: { day: string; count: number }[];
}
```

`apps/web/src/pages/reports/Reports.tsx`:
```tsx
import { IconDownload } from '@tabler/icons-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { ReportCampaign } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const br = (day: string) => day.split('-').reverse().join('/');
const fmt = (n: number) => n.toLocaleString('pt-BR');

export function Reports() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const [from, setFrom] = useState(iso(start));
  const [to, setTo] = useState(iso(today));
  const [query, setQuery] = useState({ from: iso(start), to: iso(today) });
  const [rows, setRows] = useState<ReportCampaign[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ campaigns: ReportCampaign[] }>(`/api/reports/plays?from=${query.from}&to=${query.to}`)
      .then((r) => setRows(r.campaigns))
      .catch((e) => setError(errorMessage(e)));
  }, [query]);
  useEffect(load, [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (to < from) return setError('A data final precisa ser igual ou posterior à inicial.');
    setQuery({ from, to });
  }

  const total = rows?.reduce((sum, r) => sum + r.total, 0) ?? 0;
  const csv = `/api/reports/plays.csv?from=${query.from}&to=${query.to}`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        action={<a className="btn" href={csv}><IconDownload size={16} />Baixar CSV</a>}
      />
      <p className="muted" style={{ marginTop: -12 }}>
        Inserções = anúncios exibidos até o fim nas TVs. Dias no horário de Brasília.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <form className="form-row card" style={{ maxWidth: 520, alignItems: 'end' }} onSubmit={submit}>
        <Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
        <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} required /></Field>
        <div><button className="btn btn-primary" type="submit">Atualizar</button></div>
      </form>
      {rows && rows.length > 0 && <p><strong>Total no período: {fmt(total)} inserções</strong></p>}
      <div className="list">
        {rows?.map((r) => (
          <div key={r.campaignId}>
            <div className="row">
              <div className="row-main">
                <div>{r.name}</div>
                <div className="row-sub">{r.kind === 'institutional' ? 'Midora · institucional' : r.advertiserName}</div>
              </div>
              <strong>{fmt(r.total)}</strong>
              <button
                className="btn"
                type="button"
                aria-label={`Ver dias de ${r.name}`}
                aria-expanded={open === r.campaignId}
                onClick={() => setOpen(open === r.campaignId ? null : r.campaignId)}
              >
                Dias
              </button>
            </div>
            {open === r.campaignId && (
              <ul className="timeline" style={{ padding: '0 14px 12px' }}>
                {r.days.map((d) => (
                  <li key={d.day} className="row" style={{ padding: '4px 0' }}>
                    <span className="row-main">{br(d.day)}</span>
                    <span>{fmt(d.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {rows?.length === 0 && <div className="row muted">Nenhuma inserção no período.</div>}
        {rows === null && !error && <div className="row muted">Carregando…</div>}
      </div>
    </>
  );
}
```

`apps/web/src/ui.tsx`: importar `IconChartBar` e acrescentar `{ to: '<base>/relatorios', label: 'Relatórios', icon: <IconChartBar size={18} /> }` ao fim do menu de `admin` (`/admin/relatorios`), `partner_user` (`/parceiro/relatorios`) e `advertiser` (`/anunciante/relatorios`).

`apps/web/src/App.tsx`: `<Route path="relatorios" element={<Reports />} />` sob `/admin`, `/parceiro` e `/anunciante`.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint`
Expected: PASS.
```bash
git add apps/web
git commit -m "feat(web): add plays report with daily breakdown and CSV download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação ponta a ponta e entrega

**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Demo**

```bash
pnpm build && pnpm --filter @midora/api demo   # background
```
No navegador integrado (painel visível): entrar no player como `tv@academia-demo`; aguardar ~45 s (as imagens do demo duram 4 s; o envio acontece a cada 30 s). Em outra aba, como `parceiro@demo.test`, abrir **Relatórios**: as campanhas Esmeralda e Âmbar aparecem com contagens próximas da proporção dos planos (alta 3 : baixa 1), dia de hoje. Baixar o CSV pela API do demo e conferir o cabeçalho e as linhas. Recarregar o player e confirmar que a contagem não duplica (`SELECT count(*)` = soma do relatório via `GET /api/reports/plays`). Encerrar o demo.

- [ ] **Step 2: `docs/DEPLOY.md`**

Acrescentar à seção "Player":
```markdown
- Inserções: a TV registra cada anúncio exibido até o fim e envia em lotes a cada 30 s (`POST /api/player/plays`); reenvios não duplicam. Eventos pendentes ficam guardados no navegador da TV até serem aceitos.
- Relatórios em **Relatórios** no painel (admin, parceiro, anunciante), por campanha e por dia no horário de Brasília, com CSV.
```

- [ ] **Step 3: Rodar tudo, commit, push**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
```bash
git add docs/DEPLOY.md
git commit -m "docs: document play counting and reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-4-insercoes
```
Depois: CI, revisão final, correções, merge (autorizado), conferir deploy (`POST /api/player/plays` 401 sem sessão; `/api/reports/plays` 401 sem sessão; migração `0004` aplicada).

---

## Critério de aceite da Etapa 4

- Critérios 10 e 11 da especificação cobertos por testes: reprodução concluída gera uma inserção; reenvio não duplica.
- Interrompido não conta; TV reiniciada envia o que ficou pendente.
- Relatórios por campanha e dia (Brasília), com escopo correto por papel e CSV.
- Demo mostra inserções do player aparecendo no relatório; produção atualizada.

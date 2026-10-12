# Etapa 2a — Anunciantes, planos, mídia e campanhas (API) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API completa do ciclo comercial: parceiro cadastra anunciantes e planos; anunciante também se cadastra pela página pública do parceiro; campanhas recebem imagem ou vídeo validado, passam por aprovação/correção com histórico; o admin cria campanhas institucionais; e uma função de elegibilidade garante que só campanha aprovada, no período e com mídia entra na rotação.

**Architecture:** Novos módulos em `apps/api/src`: `storage` (disco, trocável por S3), `media` (detecção de tipo, parser MP4, upload, entrega com Range), `catalog` (anunciantes e planos), `campaigns` (rotas, transições, institucionais, elegibilidade), `public` (página do parceiro e autocadastro) e `http/csrf`. Escopo de dados sempre derivado da sessão. Telas ficam para a Etapa 2b.

**Tech Stack:** o da Etapa 1 + `@fastify/multipart`. Sem ffmpeg: duração e codecs lidos por um parser MP4 próprio (caixas `moov/mvhd/trak/hdlr/stsd`).

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (seções 5, 6, 7, 9, 13 — Etapa 2)

## Global Constraints

- TypeScript `^6`; zod 4; Drizzle; testes com PGlite; migração nova **somente aditiva** (`0001_*`).
- `partnerId` e `advertiserId` vêm sempre da sessão; corpos `.strict()`; recurso de outro parceiro/anunciante responde **404** (não revela existência).
- Estados persistidos: `draft`, `pending_review`, `changes_requested`, `approved`, `cancelled`. `active`/`scheduled`/`ended` são derivados por data (`effectiveStatus`), sem job.
- Transições: `draft|changes_requested → pending_review` (exige mídia; anunciante ou parceiro); `pending_review → approved | changes_requested` (só parceiro; correção exige motivo); qualquer não cancelado `→ cancelled` (só parceiro). Edição de dados e troca de mídia só em `draft|changes_requested`. Toda transição grava `campaign_reviews` na mesma transação. Transição inválida → 409 `invalid_state`.
- `frequency_level` da campanha é copiado do plano na criação ou troca de plano.
- Mídia: imagens JPEG/PNG/WebP; vídeo MP4 com vídeo `avc1|avc3` (H.264) e áudio ausente ou `mp4a` (AAC). Tipo pelo conteúdo, não pela extensão. Limites `MAX_IMAGE_MB` (10) e `MAX_VIDEO_MB` (200). Erros: 413 `file_too_large`, 415 `unsupported_media`, 400 `file_required`.
- Trocar a mídia cria nova linha em `media`; a anterior é preservada.
- Institucionais: criadas pelo admin já `approved`, sem parceiro/anunciante/plano; só elegíveis em parceiros com `show_institutional = true`.
- Requisições não-GET em `/api/*` vindas de outro site (`Sec-Fetch-Site: cross-site` ou `Origin` com host diferente) → 403.
- Branch `feat/etapa-2a-campanhas-api`; Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; merge só com aprovação.
- **Decisões desta etapa:** (a) autocadastro de anunciante cria a conta já ativa — o controle está na aprovação de cada campanha; (b) anunciante cadastrado manualmente não tem login nesta etapa (o parceiro opera por ele); (c) mídia institucional é visível a qualquer usuário de parceiro/player (é anúncio público); (d) `campaigns.current_media_id` referencia `media` com `ON DELETE SET NULL`; (e) backup do volume de mídia fica para antes do piloto, junto com o destino externo de backups.

## Review Focus

1. Arquivo com extensão `.mp4` mas conteúdo de texto, ou vídeo HEVC/VP9, deve ser recusado com 415, sem deixar arquivo temporário no disco — testes na Task 2 e Task 5.
2. Player na TV pede o vídeo com `Range` (início, meio, fim, sufixo `bytes=-N`); deve receber 206 com `Content-Range` correto e 416 para faixa inválida — teste na Task 5.
3. Campanha aprovada mas com data de fim no passado, ou início no futuro, nunca entra na elegibilidade; nem `pending_review`, `changes_requested`, `cancelled` ou sem mídia — teste na Task 6.
4. Parceiro B tentando ler/aprovar/baixar mídia de campanha do parceiro A recebe 404; anunciante X não vê campanhas do anunciante Y do mesmo parceiro — testes nas Tasks 4 e 5.
5. Formulário de outro site tentando aprovar campanha com o cookie do parceiro é bloqueado — teste na Task 3.
6. Toda rota protegida sem sessão responde 401 (nenhuma rota esquecida sem guarda) — teste na Task 6.

---

## Estrutura de arquivos

```
apps/api/src/
  db/schema.ts                 (mod) advertisers, plans, campaigns, media, campaign_reviews; users.advertiser_id
  auth/sessions.ts             (mod) SessionUser.advertiserId
  auth/plugin.ts               (mod) setSessionCookie exportado; login devolve advertiserId
  http/csrf.ts                 registerCsrfGuard(app)
  storage/local.ts             LocalStorage
  media/detect.ts              detectImageMime, isMp4
  media/mp4.ts                 probeMp4
  media/upload.ts              receiveUpload, UploadLimits
  media/attach.ts              attachMedia (grava linha media, move arquivo, atualiza campanha)
  media/routes.ts              GET /api/media/:id (Range, ETag)
  catalog/routes.ts            /api/partner/advertisers*, /api/partner/plans*, GET /api/advertiser
  campaigns/status.ts          effectiveStatus
  campaigns/routes.ts          /api/campaigns* (parceiro e anunciante)
  campaigns/admin-routes.ts    /api/admin/campaigns* (institucionais)
  campaigns/eligibility.ts     listEligible(db, partnerId, now)
  public/routes.ts             /api/public/partners/:slug*, autocadastro
  config.ts                    (mod) mediaDir, maxImageMb, maxVideoMb
  app.ts / server.ts           (mod) storage, multipart, CSRF, novas rotas
apps/api/test/
  helpers/mp4.ts               buildMp4 (MP4 sintético), PNG/JPEG mínimos
  helpers/app.ts               createTestApp, multipart, seed
  schema.test.ts (mod) media.test.ts catalog.test.ts public.test.ts csrf.test.ts
  campaigns.test.ts media-routes.test.ts eligibility.test.ts guard.test.ts
Dockerfile (mod) docs/DEPLOY.md (mod)
```

---

### Task 1: Schema da Etapa 2 e advertiserId na sessão

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/plugin.ts`, `apps/api/test/schema.test.ts`, `apps/api/test/sessions.test.ts`
- Create (gerado): `apps/api/drizzle/0001_*.sql`

**Interfaces:**
- Produces: tabelas `advertisers`, `plans`, `campaigns`, `media`, `campaignReviews`; `users.advertiserId`; constantes `FREQUENCY_LEVELS`, `CAMPAIGN_STATUSES`, tipos `FrequencyLevel`, `CampaignStatus`; `SessionUser.advertiserId: string | null`; `setSessionCookie(reply, token, expiresAt, cookieSecure)`.

- [ ] **Step 1: Branch e dependência**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-2a-campanhas-api
pnpm --filter @midora/api add @fastify/multipart
```

- [ ] **Step 2: Testes de constraint que falham**

Acrescentar a `apps/api/test/schema.test.ts` (imports: `advertisers, campaigns, plans` de `../src/db/schema`):
```ts
it('requires advertiser users to point to an advertiser and others not to', async () => {
  const [adv] = await db.insert(advertisers).values({ partnerId, name: 'Loja', source: 'manual' }).returning();
  await expect(
    db.insert(users).values({ email: 'adv@x.com', passwordHash: 'h', role: 'advertiser', partnerId }),
  ).rejects.toThrow();
  await expect(
    db.insert(users).values({ email: 'pu@x.com', passwordHash: 'h', role: 'partner_user', partnerId, advertiserId: adv!.id }),
  ).rejects.toThrow();
  await db.insert(users).values({ email: 'ok@x.com', passwordHash: 'h', role: 'advertiser', partnerId, advertiserId: adv!.id });
});

it('enforces commercial vs institutional campaign scope and period', async () => {
  const [adv] = await db.insert(advertisers).values({ partnerId, name: 'Loja 2', source: 'manual' }).returning();
  const [plan] = await db.insert(plans).values({ partnerId, name: 'Básico', frequencyLevel: 'low' }).returning();
  const base = { name: 'C', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-02-01'), frequencyLevel: 'low' as const };
  await expect(db.insert(campaigns).values({ ...base, kind: 'commercial', partnerId })).rejects.toThrow();
  await expect(
    db.insert(campaigns).values({ ...base, kind: 'institutional', partnerId, advertiserId: adv!.id, planId: plan!.id }),
  ).rejects.toThrow();
  await expect(
    db.insert(campaigns).values({ ...base, kind: 'institutional', endsAt: new Date('2025-12-01') }),
  ).rejects.toThrow();
  await db.insert(campaigns).values({ ...base, kind: 'commercial', partnerId, advertiserId: adv!.id, planId: plan!.id });
  await db.insert(campaigns).values({ ...base, kind: 'institutional', status: 'approved' });
});
```

Em `apps/api/test/sessions.test.ts`, no teste `stores only the token hash and resolves the user`, a expectativa passa a incluir `advertiserId: null`:
```ts
    expect(await findSessionUser(db, token)).toEqual({
      id: u.id, email: 'u@s1.com', role: 'partner_user', partnerId: p.id, advertiserId: null,
    });
```

Run: `pnpm --filter @midora/api test -- schema sessions`
Expected: FAIL — `advertisers`/`plans`/`campaigns` não exportados; `advertiserId` ausente.

- [ ] **Step 3: Schema**

Em `apps/api/src/db/schema.ts`: importar `bigint` e `type AnyPgColumn` de `drizzle-orm/pg-core`; declarar `advertisers` **antes** de `users`; acrescentar `advertiserId` e a constraint em `users`; acrescentar as demais tabelas no fim.

```ts
export const advertisers = pgTable(
  'advertisers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    source: text('source', { enum: ['manual', 'self_signup'] }).notNull(),
    ...timestamps,
  },
  (t) => [
    check('advertisers_source_check', sql`${t.source} in ('manual', 'self_signup')`),
    index('advertisers_partner_idx').on(t.partnerId),
  ],
);
```

Em `users`, novo campo e nova constraint:
```ts
    advertiserId: uuid('advertiser_id').references(() => advertisers.id, { onDelete: 'restrict' }),
```
```ts
    check('users_advertiser_scope_check', sql`(${t.role} = 'advertiser') = (${t.advertiserId} is not null)`),
```

No fim do arquivo:
```ts
export const FREQUENCY_LEVELS = ['low', 'medium', 'high'] as const;
export type FrequencyLevel = (typeof FREQUENCY_LEVELS)[number];

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    frequencyLevel: text('frequency_level', { enum: FREQUENCY_LEVELS }).notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check('plans_frequency_check', sql`${t.frequencyLevel} in ('low', 'medium', 'high')`),
    index('plans_partner_idx').on(t.partnerId),
  ],
);

export const CAMPAIGN_STATUSES = ['draft', 'pending_review', 'changes_requested', 'approved', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    advertiserId: uuid('advertiser_id').references(() => advertisers.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['commercial', 'institutional'] }).notNull(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('draft'),
    frequencyLevel: text('frequency_level', { enum: FREQUENCY_LEVELS }).notNull(),
    currentMediaId: uuid('current_media_id').references((): AnyPgColumn => media.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    check('campaigns_kind_check', sql`${t.kind} in ('commercial', 'institutional')`),
    check(
      'campaigns_status_check',
      sql`${t.status} in ('draft', 'pending_review', 'changes_requested', 'approved', 'cancelled')`,
    ),
    check('campaigns_frequency_check', sql`${t.frequencyLevel} in ('low', 'medium', 'high')`),
    check('campaigns_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'campaigns_scope_check',
      sql`(${t.kind} = 'commercial' and ${t.partnerId} is not null and ${t.advertiserId} is not null and ${t.planId} is not null)
       or (${t.kind} = 'institutional' and ${t.partnerId} is null and ${t.advertiserId} is null and ${t.planId} is null)`,
    ),
    index('campaigns_partner_status_idx').on(t.partnerId, t.status),
    index('campaigns_advertiser_idx').on(t.advertiserId),
  ],
);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').notNull().references((): AnyPgColumn => campaigns.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull().unique(),
    mediaType: text('media_type', { enum: ['image', 'video'] }).notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    displaySeconds: integer('display_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('media_type_check', sql`${t.mediaType} in ('image', 'video')`),
    check('media_display_check', sql`(${t.mediaType} = 'image') = (${t.displaySeconds} is not null)`),
    index('media_campaign_idx').on(t.campaignId),
  ],
);

export const campaignReviews = pgTable(
  'campaign_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['submitted', 'approved', 'changes_requested', 'cancelled'] }).notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('campaign_reviews_action_check', sql`${t.action} in ('submitted', 'approved', 'changes_requested', 'cancelled')`),
    index('campaign_reviews_campaign_idx').on(t.campaignId),
  ],
);
```

- [ ] **Step 4: Sessão com advertiserId**

`apps/api/src/auth/sessions.ts`: `SessionUser` ganha `advertiserId: string | null`; em `findSessionUser` acrescentar `advertiserId: users.advertiserId` ao `select` e ao objeto retornado:
```ts
  return { id: row.id, email: row.email, role: row.role, partnerId: row.partnerId, advertiserId: row.advertiserId };
```

`apps/api/src/auth/plugin.ts`: exportar o helper e usá-lo no login; o login seleciona e devolve `advertiserId`:
```ts
export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, cookieSecure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure, expires: expiresAt,
  });
}
```
(importar `type FastifyReply` de `fastify`); no select do login acrescentar `advertiserId: users.advertiserId`; substituir o `reply.setCookie(...)` por `setSessionCookie(reply, token, expiresAt, cookieSecure)`; e o retorno:
```ts
    const { id, email, role, partnerId, advertiserId } = user;
    return { user: { id, email, role, partnerId, advertiserId } };
```

- [ ] **Step 5: Gerar migração e rodar**

Run: `pnpm --filter @midora/api db:generate --name campaigns && pnpm --filter @midora/api test && pnpm typecheck`
Expected: `drizzle/0001_campaigns.sql` contém somente `CREATE TABLE`, `ALTER TABLE "users" ADD COLUMN "advertiser_id"`, `ADD CONSTRAINT`, `CREATE INDEX` — nenhum `DROP`. Todos os testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add advertisers, plans, campaigns, media and reviews schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Armazenamento e validação de mídia

**Files:**
- Create: `apps/api/src/storage/local.ts`, `apps/api/src/media/detect.ts`, `apps/api/src/media/mp4.ts`, `apps/api/test/helpers/mp4.ts`, `apps/api/test/media.test.ts`

**Interfaces:**
- Produces:
  - `class LocalStorage { constructor(root: string); init(): Promise<void>; tmpPath(): string; saveFrom(tmpPath: string, key: string): Promise<void>; createReadStream(key: string, range?: { start: number; end: number }): ReadStream; remove(key: string): Promise<void>; exists(key: string): Promise<boolean> }` — rejeita chaves que saiam da raiz.
  - `detectImageMime(head: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null`; `isMp4(head: Buffer): boolean`
  - `interface Mp4Info { durationMs: number; videoCodec: string | null; audioCodec: string | null }`; `probeMp4(path: string): Promise<Mp4Info>` (lança `Error('invalid mp4')`)
  - helpers de teste: `buildMp4(opts?)`, `PNG_BYTES`, `JPEG_BYTES`

- [ ] **Step 1: Helpers de teste**

`apps/api/test/helpers/mp4.ts`:
```ts
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export function box(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function trak(handler: 'vide' | 'soun', codec: string): Buffer {
  return box(
    'trak',
    box(
      'mdia',
      box('hdlr', u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)),
      box('minf', box('stbl', box('stsd', u32(0), u32(1), box(codec, Buffer.alloc(8))))),
    ),
  );
}

/** Minimal structurally valid MP4 (no real frames): enough for box parsing. */
export function buildMp4(
  opts: { durationMs?: number; video?: string; audio?: string | null; moovAtEnd?: boolean; mvhdVersion?: 0 | 1 } = {},
): Buffer {
  const { durationMs = 5000, video = 'avc1', audio = 'mp4a', moovAtEnd = false, mvhdVersion = 0 } = opts;
  const timescale = 1000;
  const mvhd =
    mvhdVersion === 0
      ? box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(durationMs), Buffer.alloc(80))
      : box(
          'mvhd',
          Buffer.from([1, 0, 0, 0]),
          Buffer.alloc(8),
          Buffer.alloc(8),
          u32(timescale),
          Buffer.from(BigInt(durationMs).toString(16).padStart(16, '0'), 'hex'),
          Buffer.alloc(80),
        );
  const moov = box('moov', mvhd, trak('vide', video), ...(audio ? [trak('soun', audio)] : []));
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomavc1', 'latin1'));
  const mdat = box('mdat', Buffer.alloc(2048, 7));
  return Buffer.concat(moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(64, 3),
]);
```

- [ ] **Step 2: Testes que falham**

`apps/api/test/media.test.ts`:
```ts
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectImageMime, isMp4 } from '../src/media/detect';
import { probeMp4 } from '../src/media/mp4';
import { LocalStorage } from '../src/storage/local';
import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES, buildMp4 } from './helpers/mp4';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'midora-media-')); });
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('detect', () => {
  it('recognizes image signatures and mp4', () => {
    expect(detectImageMime(PNG_BYTES)).toBe('image/png');
    expect(detectImageMime(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectImageMime(WEBP_BYTES)).toBe('image/webp');
    expect(detectImageMime(Buffer.from('hello world, not an image'))).toBeNull();
    expect(isMp4(buildMp4())).toBe(true);
    expect(isMp4(PNG_BYTES)).toBe(false);
  });
});

describe('probeMp4', () => {
  const write = async (name: string, data: Buffer) => {
    const p = join(dir, name);
    await writeFile(p, data);
    return p;
  };

  it('reads duration and codecs with moov first or last', async () => {
    expect(await probeMp4(await write('a.mp4', buildMp4({ durationMs: 15000 })))).toEqual({
      durationMs: 15000, videoCodec: 'avc1', audioCodec: 'mp4a',
    });
    expect((await probeMp4(await write('b.mp4', buildMp4({ moovAtEnd: true, durationMs: 7000 })))).durationMs).toBe(7000);
  });

  it('reads version 1 mvhd', async () => {
    expect((await probeMp4(await write('v1.mp4', buildMp4({ mvhdVersion: 1, durationMs: 42000 })))).durationMs).toBe(42000);
  });

  it('reports HEVC and missing audio', async () => {
    expect(await probeMp4(await write('h.mp4', buildMp4({ video: 'hvc1', audio: null })))).toEqual({
      durationMs: 5000, videoCodec: 'hvc1', audioCodec: null,
    });
  });

  it('rejects files without moov and truncated boxes', async () => {
    await expect(probeMp4(await write('t.mp4', Buffer.from('not really an mp4 file at all')))).rejects.toThrow('invalid mp4');
    const full = buildMp4();
    await expect(probeMp4(await write('cut.mp4', full.subarray(0, 40)))).rejects.toThrow('invalid mp4');
  });
});

describe('LocalStorage', () => {
  it('moves temp files into keys, streams ranges and removes', async () => {
    const s = new LocalStorage(join(dir, 'store'));
    await s.init();
    const tmp = s.tmpPath();
    await writeFile(tmp, Buffer.from('0123456789'));
    await s.saveFrom(tmp, 'p1/m1.png');
    expect(await s.exists('p1/m1.png')).toBe(true);
    expect(await readdir(join(dir, 'store', 'tmp'))).toHaveLength(0);
    const chunks: Buffer[] = [];
    for await (const c of s.createReadStream('p1/m1.png', { start: 2, end: 5 })) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('2345');
    expect((await readFile(join(dir, 'store', 'p1/m1.png'))).toString()).toBe('0123456789');
    await s.remove('p1/m1.png');
    expect(await s.exists('p1/m1.png')).toBe(false);
  });

  it('refuses keys that escape the root', async () => {
    const s = new LocalStorage(join(dir, 'store2'));
    await s.init();
    expect(() => s.createReadStream('../../etc/passwd')).toThrow('invalid storage key');
  });
});
```

Run: `pnpm --filter @midora/api test -- media`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementação**

`apps/api/src/storage/local.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Disk-backed media storage. Callers only use keys, so it can be swapped for S3 later.
export class LocalStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, 'tmp'), { recursive: true });
  }

  tmpPath(): string {
    return join(this.root, 'tmp', randomUUID());
  }

  async saveFrom(tmpPath: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(dirname(dest), { recursive: true });
    await rename(tmpPath, dest);
  }

  createReadStream(key: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.resolve(key), range);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return p;
  }
}
```

`apps/api/src/media/detect.ts`:
```ts
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMime(head: Buffer): ImageMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function isMp4(head: Buffer): boolean {
  return head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
}
```

`apps/api/src/media/mp4.ts`:
```ts
import { open } from 'node:fs/promises';

export interface Mp4Info {
  durationMs: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

interface Box {
  type: string;
  start: number; // payload start
  end: number; // payload end
}

const MAX_MOOV_BYTES = 50 * 1024 * 1024;
const invalid = () => new Error('invalid mp4');

function children(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (size < 8 || pos + size > end) throw invalid();
    boxes.push({ type, start: pos + 8, end: pos + size });
    pos += size;
  }
  return boxes;
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return children(buf, parent.start, parent.end).find((b) => b.type === type);
}

function path(buf: Buffer, parent: Box, types: string[]): Box | undefined {
  let current: Box | undefined = parent;
  for (const t of types) current = current && child(buf, current, t);
  return current;
}

function parseMoov(buf: Buffer): Mp4Info {
  const moov: Box = { type: 'moov', start: 0, end: buf.length };
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd) throw invalid();
  const version = buf[mvhd.start];
  const timescale = buf.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
  if (!timescale) throw invalid();

  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const trak of children(buf, moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const hdlr = path(buf, trak, ['mdia', 'hdlr']);
    const stsd = path(buf, trak, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!hdlr || !stsd || stsd.end - stsd.start < 16) continue;
    const handler = buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
    // stsd: version/flags(4) + entry_count(4), then first sample entry: size(4) + format(4)
    const codec = buf.toString('latin1', stsd.start + 12, stsd.start + 16);
    if (handler === 'vide' && !videoCodec) videoCodec = codec;
    if (handler === 'soun' && !audioCodec) audioCodec = codec;
  }
  return { durationMs: Math.round((duration * 1000) / timescale), videoCodec, audioCodec };
}

/** Reads duration and codecs from the moov box without loading media data. */
export async function probeMp4(filePath: string): Promise<Mp4Info> {
  const fh = await open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const header = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= size) {
      await fh.read(header, 0, 16, pos);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (boxSize < headerSize || pos + boxSize > size) throw invalid();
      if (type === 'moov') {
        if (boxSize > MAX_MOOV_BYTES) throw invalid();
        const moov = Buffer.alloc(boxSize - headerSize);
        await fh.read(moov, 0, moov.length, pos + headerSize);
        try {
          return parseMoov(moov);
        } catch {
          throw invalid();
        }
      }
      pos += boxSize;
    }
    throw invalid();
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test -- media && pnpm --filter @midora/api typecheck`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add local media storage, image detection and MP4 probing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Anunciantes, planos, página pública, autocadastro e CSRF

**Files:**
- Create: `apps/api/src/http/csrf.ts`, `apps/api/src/catalog/routes.ts`, `apps/api/src/public/routes.ts`, `apps/api/test/helpers/app.ts`, `apps/api/test/catalog.test.ts`, `apps/api/test/public.test.ts`, `apps/api/test/csrf.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `requireRole`, `parse`, `isUniqueViolation`, `hashPassword`, `createSession`, `setSessionCookie`, tabelas.
- Produces:
  - `registerCsrfGuard(app)`
  - `catalogRoutes: FastifyPluginAsync<{ db: Db }>` — parceiro: `GET|POST /api/partner/advertisers`, `PATCH /api/partner/advertisers/:id`, `GET|POST /api/partner/plans`, `PATCH /api/partner/plans/:id`; anunciante: `GET /api/advertiser`
  - `publicRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean }>` — `GET /api/public/partners/:slug` → `{ partner: { name, slug }, plans }`; `POST /api/public/partners/:slug/advertisers` `{ companyName, contactName, email, phone?, password }` → 201 `{ user }` + cookie
  - `AppOptions` ganha `storage?: LocalStorage`, `uploadLimits?: UploadLimits` (usados na Task 5)
  - helpers: `createTestApp(opts?)` → `{ app, db, storage, close }`; `seed(db)` → `{ partnerA, partnerB, cookies… }` (definido no Step 1)

- [ ] **Step 1: Helper de app de teste**

`apps/api/test/helpers/app.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import type { Db } from '../../src/db/client';
import { LocalStorage } from '../../src/storage/local';
import { createTestDb } from './db';
import { createPartner, createUser, login } from './fixtures';

export async function createTestApp(opts: { maxImageBytes?: number; maxVideoBytes?: number } = {}) {
  const { db, close: closeDb } = await createTestDb();
  const dir = await mkdtemp(join(tmpdir(), 'midora-app-'));
  const storage = new LocalStorage(dir);
  await storage.init();
  const app = await buildApp({
    version: 't',
    db,
    storage,
    uploadLimits: {
      maxImageBytes: opts.maxImageBytes ?? 1024 * 1024,
      maxVideoBytes: opts.maxVideoBytes ?? 4 * 1024 * 1024,
    },
  });
  return {
    app,
    db,
    storage,
    close: async () => {
      await app.close();
      await closeDb();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Two partners, each with a manager; partner A also has a plan and an admin exists. */
export async function seed(app: FastifyInstance, db: Db) {
  const partnerA = await createPartner(db, 'parceiro-a');
  const partnerB = await createPartner(db, 'parceiro-b');
  await createUser(db, { email: 'admin@midora.com', password: 'senha-admin-1', role: 'admin' });
  await createUser(db, { email: 'g@a.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerA.id });
  await createUser(db, { email: 'g@b.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerB.id });
  return {
    partnerA,
    partnerB,
    admin: await login(app, 'admin@midora.com', 'senha-admin-1'),
    gerenteA: await login(app, 'g@a.com', 'senha-forte-1'),
    gerenteB: await login(app, 'g@b.com', 'senha-forte-1'),
  };
}

export function multipart(
  file: { filename: string; contentType: string; data: Buffer },
  fields: Record<string, string> = {},
) {
  const boundary = '----midora' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
```

Em `apps/api/src/app.ts`, `AppOptions` ganha (com imports de tipo):
```ts
  storage?: LocalStorage;
  uploadLimits?: UploadLimits;
```
e `UploadLimits` é declarado agora em `apps/api/src/media/upload.ts` (implementação completa na Task 5):
```ts
export interface UploadLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
}
```

- [ ] **Step 2: Testes que falham**

`apps/api/test/catalog.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

describe('advertisers', () => {
  it('partner creates, lists and updates its advertisers', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Academia Sul', contactName: 'Ana', phone: '11 9999' });
    expect(res.statusCode).toBe(201);
    expect(res.json().advertiser).toMatchObject({ name: 'Academia Sul', source: 'manual', partnerId: s.partnerA.id });
    const id = res.json().advertiser.id;
    const upd = await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteA, { email: 'Ana@Sul.com' });
    expect(upd.json().advertiser.email).toBe('ana@sul.com');
    const list = await req('GET', '/api/partner/advertisers', s.gerenteA);
    expect(list.json().advertisers.map((a: { id: string }) => a.id)).toContain(id);
  });

  it('isolates advertisers between partners', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Só do A' });
    const id = res.json().advertiser.id;
    const listB = await req('GET', '/api/partner/advertisers', s.gerenteB);
    expect(listB.json().advertisers.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteB, { name: 'hack' })).statusCode).toBe(404);
  });
});

describe('plans', () => {
  it('partner manages plans and partners are isolated', async () => {
    const res = await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Ouro', description: 'Mais exibições', frequencyLevel: 'high' });
    expect(res.statusCode).toBe(201);
    const id = res.json().plan.id;
    expect(res.json().plan).toMatchObject({ frequencyLevel: 'high', active: true });
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteA, { active: false })).json().plan.active).toBe(false);
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteB, { active: true })).statusCode).toBe(404);
    expect((await req('POST', '/api/partner/plans', s.gerenteA, { name: 'X', frequencyLevel: 'max' })).statusCode).toBe(400);
  });
});
```

`apps/api/test/public.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partners } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  await t.app.inject({ method: 'POST', url: '/api/partner/plans', headers: { cookie: s.gerenteA }, payload: { name: 'Bronze', frequencyLevel: 'low' } });
  const off = await t.app.inject({ method: 'POST', url: '/api/partner/plans', headers: { cookie: s.gerenteA }, payload: { name: 'Antigo', frequencyLevel: 'medium' } });
  await t.app.inject({ method: 'PATCH', url: `/api/partner/plans/${off.json().plan.id}`, headers: { cookie: s.gerenteA }, payload: { active: false } });
});
afterAll(() => t.close());

describe('public partner page', () => {
  it('shows name and only active plans', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/public/partners/parceiro-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json().partner).toEqual({ name: 'Parceiro parceiro-a', slug: 'parceiro-a' });
    expect(res.json().plans.map((p: { name: string }) => p.name)).toEqual(['Bronze']);
    expect(res.json().plans[0].partnerId).toBeUndefined();
  });

  it('is 404 for unknown or inactive partners', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/public/partners/nao-existe' })).statusCode).toBe(404);
    await t.db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, s.partnerB.id));
    expect((await t.app.inject({ method: 'GET', url: '/api/public/partners/parceiro-b' })).statusCode).toBe(404);
  });
});

describe('advertiser self-signup', () => {
  const body = { companyName: 'Loja Fit', contactName: 'Bia', email: 'Bia@LojaFit.com', password: 'senha-loja-1' };

  it('creates advertiser and user, and signs in', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'bia@lojafit.com', role: 'advertiser', partnerId: s.partnerA.id });
    const cookie = res.cookies.find((c) => c.name === 'midora_session')!;
    const me = await t.app.inject({ method: 'GET', url: '/api/advertiser', headers: { cookie: `midora_session=${cookie.value}` } });
    expect(me.json().advertiser).toMatchObject({ name: 'Loja Fit', source: 'self_signup', email: 'bia@lojafit.com' });
    const list = await t.app.inject({ method: 'GET', url: '/api/partner/advertisers', headers: { cookie: s.gerenteA } });
    expect(list.json().advertisers.map((a: { name: string }) => a.name)).toContain('Loja Fit');
  });

  it('rejects duplicate e-mail, weak password and unknown partner', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: body })).json())
      .toEqual({ error: 'email_taken' });
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, email: 'x@y.com', password: '123' } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/nao-existe/advertisers', payload: { ...body, email: 'z@y.com' } })).statusCode).toBe(404);
  });

  it('advertiser cannot use partner routes', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, email: 'c@lojafit.com' } });
    const cookie = `midora_session=${res.cookies.find((c) => c.name === 'midora_session')!.value}`;
    expect((await t.app.inject({ method: 'GET', url: '/api/partner/advertisers', headers: { cookie } })).statusCode).toBe(403);
  });
});
```

`apps/api/test/csrf.test.ts`:
```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const create = (headers: Record<string, string>) =>
  t.app.inject({
    method: 'POST',
    url: '/api/partner/plans',
    headers: { cookie: s.gerenteA, host: 'midora.test', ...headers },
    payload: { name: 'P', frequencyLevel: 'low' },
  });

it('blocks cross-site requests', async () => {
  expect((await create({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
  expect((await create({ origin: 'https://evil.example' })).statusCode).toBe(403);
});

it('allows same-origin and non-browser requests', async () => {
  expect((await create({ 'sec-fetch-site': 'same-origin', origin: 'http://midora.test' })).statusCode).toBe(201);
  expect((await create({})).statusCode).toBe(201);
});

it('does not block GET requests', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/partner/plans', headers: { cookie: s.gerenteA, 'sec-fetch-site': 'cross-site' } });
  expect(res.statusCode).toBe(200);
});
```

Run: `pnpm --filter @midora/api test -- catalog public csrf`
Expected: FAIL — rotas inexistentes (404) e `createTestApp` falha no typecheck de `storage`/`uploadLimits` até o Step 3.

- [ ] **Step 3: Implementação**

`apps/api/src/http/csrf.ts`:
```ts
import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rejects state-changing API calls initiated by another site with the user's cookie.
export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.code(403).send({ error: 'forbidden' });
    }
  });
}
```

`apps/api/src/catalog/routes.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { FREQUENCY_LEVELS, advertisers, plans } from '../db/schema';
import { parse } from '../http/validation';

const Email = z.string().trim().toLowerCase().pipe(z.email());
const AdvertiserFields = {
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(120).nullable().optional(),
  email: Email.nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
};
const CreateAdvertiser = z.object(AdvertiserFields).strict();
const UpdateAdvertiser = z.object(AdvertiserFields).partial().strict();

const PlanFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  frequencyLevel: z.enum(FREQUENCY_LEVELS),
};
const CreatePlan = z.object(PlanFields).strict();
const UpdatePlan = z.object({ ...PlanFields, active: z.boolean() }).partial().strict();

const IdParams = z.object({ id: z.uuid() });

export const catalogRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const partnerOnly = { preHandler: requireRole('partner_user') };

  app.get('/api/partner/advertisers', partnerOnly, async (req) => ({
    advertisers: await db
      .select()
      .from(advertisers)
      .where(eq(advertisers.partnerId, req.user!.partnerId!))
      .orderBy(asc(advertisers.name)),
  }));

  app.post('/api/partner/advertisers', partnerOnly, async (req, reply) => {
    const body = parse(CreateAdvertiser, req.body, reply);
    if (!body) return reply;
    const [advertiser] = await db
      .insert(advertisers)
      .values({ ...body, partnerId: req.user!.partnerId!, source: 'manual' })
      .returning();
    return reply.code(201).send({ advertiser });
  });

  app.patch('/api/partner/advertisers/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateAdvertiser, req.body, reply);
    if (!body) return reply;
    const [advertiser] = await db
      .update(advertisers)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(advertisers.id, params.id), eq(advertisers.partnerId, req.user!.partnerId!)))
      .returning();
    if (!advertiser) return reply.code(404).send({ error: 'not_found' });
    return { advertiser };
  });

  app.get('/api/partner/plans', partnerOnly, async (req) => ({
    plans: await db.select().from(plans).where(eq(plans.partnerId, req.user!.partnerId!)).orderBy(asc(plans.name)),
  }));

  app.post('/api/partner/plans', partnerOnly, async (req, reply) => {
    const body = parse(CreatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db.insert(plans).values({ ...body, partnerId: req.user!.partnerId! }).returning();
    return reply.code(201).send({ plan });
  });

  app.patch('/api/partner/plans/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db
      .update(plans)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(plans.id, params.id), eq(plans.partnerId, req.user!.partnerId!)))
      .returning();
    if (!plan) return reply.code(404).send({ error: 'not_found' });
    return { plan };
  });

  app.get('/api/advertiser', { preHandler: requireRole('advertiser') }, async (req) => {
    const [advertiser] = await db.select().from(advertisers).where(eq(advertisers.id, req.user!.advertiserId!));
    return { advertiser };
  });
};
```

`apps/api/src/public/routes.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { setSessionCookie } from '../auth/plugin';
import { createSession } from '../auth/sessions';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { advertisers, partners, plans, users } from '../db/schema';
import { parse } from '../http/validation';

const SlugParams = z.object({ slug: z.string().max(60) });
const Signup = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    contactName: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: z.string().trim().min(3).max(40).optional(),
    password: z.string().min(8).max(200),
  })
  .strict();

export const publicRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean }> = async (
  app,
  { db, cookieSecure },
) => {
  const activePartner = async (slug: string) => {
    const [p] = await db
      .select({ id: partners.id, name: partners.name, slug: partners.slug })
      .from(partners)
      .where(and(eq(partners.slug, slug), eq(partners.status, 'active')));
    return p;
  };

  app.get('/api/public/partners/:slug', async (req, reply) => {
    const params = parse(SlugParams, req.params, reply);
    if (!params) return reply;
    const partner = await activePartner(params.slug);
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    const list = await db
      .select({ id: plans.id, name: plans.name, description: plans.description, frequencyLevel: plans.frequencyLevel })
      .from(plans)
      .where(and(eq(plans.partnerId, partner.id), eq(plans.active, true)))
      .orderBy(asc(plans.name));
    return { partner: { name: partner.name, slug: partner.slug }, plans: list };
  });

  app.post(
    '/api/public/partners/:slug/advertisers',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const params = parse(SlugParams, req.params, reply);
      if (!params) return reply;
      const body = parse(Signup, req.body, reply);
      if (!body) return reply;
      const partner = await activePartner(params.slug);
      if (!partner) return reply.code(404).send({ error: 'not_found' });
      const passwordHash = await hashPassword(body.password);
      try {
        const user = await db.transaction(async (tx) => {
          const [advertiser] = await tx
            .insert(advertisers)
            .values({
              partnerId: partner.id,
              name: body.companyName,
              contactName: body.contactName,
              email: body.email,
              phone: body.phone ?? null,
              source: 'self_signup',
            })
            .returning();
          const [created] = await tx
            .insert(users)
            .values({ email: body.email, passwordHash, role: 'advertiser', partnerId: partner.id, advertiserId: advertiser!.id })
            .returning({ id: users.id, email: users.email, role: users.role, partnerId: users.partnerId, advertiserId: users.advertiserId });
          return created!;
        });
        const { token, expiresAt } = await createSession(db, user);
        setSessionCookie(reply, token, expiresAt, cookieSecure);
        return reply.code(201).send({ user });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send({ error: 'email_taken' });
        throw err;
      }
    },
  );
};
```

`apps/api/src/app.ts` — no bloco `if (opts.db)`, **antes** de `registerAuth`, registrar o guard de CSRF; depois das rotas da Etapa 1, registrar as novas:
```ts
  if (opts.db) {
    registerCsrfGuard(app);
    await registerAuth(app, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
    await app.register(adminPartnerRoutes, { db: opts.db });
    await app.register(partnerRoutes, { db: opts.db });
    await app.register(catalogRoutes, { db: opts.db });
    await app.register(publicRoutes, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
  }
```
(com os imports correspondentes).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: todos PASS (catalog 3, public 5, csrf 3 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add advertisers, plans, public partner page, self-signup and CSRF guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Campanhas comerciais e fluxo de aprovação

**Files:**
- Create: `apps/api/src/campaigns/status.ts`, `apps/api/src/campaigns/routes.ts`, `apps/api/test/campaigns.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `effectiveStatus(c: { status: CampaignStatus; startsAt: Date; endsAt: Date }, now?: Date): CampaignStatus | 'scheduled' | 'active' | 'ended'`
  - `campaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits }>` com:
    - `GET /api/campaigns` → `{ campaigns: (Campaign & { effectiveStatus })[] }`
    - `GET /api/campaigns/:id` → `{ campaign, media: Media | null, reviews }`
    - `POST /api/campaigns` `{ advertiserId? , planId, name, startsAt, endsAt }` → 201 `{ campaign }`
    - `PATCH /api/campaigns/:id` `{ name?, planId?, startsAt?, endsAt? }`
    - `POST /api/campaigns/:id/submit | approve | request-changes {reason} | cancel` → `{ campaign }`
  - helpers internos exportados para a Task 5: `loadScopedCampaign(db, user, id)`, `transition(db, opts)`
  - erros: `invalid_plan` (400), `invalid_period` (400), `media_required` (409), `invalid_state` (409)

- [ ] **Step 1: Teste que falha**

`apps/api/test/campaigns.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectiveStatus } from '../src/campaigns/status';
import { campaigns } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestApp, seed } from './helpers/app';
import { PNG_BYTES } from './helpers/mp4';
import { multipart } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let planA: string;
let planB: string;
let advA: string;
let advCookie: string;
let advOtherCookie: string;

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

const signup = async (email: string) => {
  const res = await req('POST', '/api/public/partners/parceiro-a/advertisers', undefined, {
    companyName: `Empresa ${email}`, contactName: 'C', email, password: 'senha-anunc-1',
  });
  return `midora_session=${res.cookies.find((c) => c.name === 'midora_session')!.value}`;
};

const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' };

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  planA = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Ouro', frequencyLevel: 'high' })).json().plan.id;
  planB = (await req('POST', '/api/partner/plans', s.gerenteB, { name: 'B', frequencyLevel: 'low' })).json().plan.id;
  advA = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Manual A' })).json().advertiser.id;
  advCookie = await signup('anunc@x.com');
  advOtherCookie = await signup('outro@x.com');
});
afterAll(() => t.close());

const uploadPng = (id: string, cookie: string) => {
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  return t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/media`, headers: { cookie, ...m.headers }, payload: m.payload });
};

describe('creating campaigns', () => {
  it('partner creates a draft for its advertiser with the plan frequency', async () => {
    const res = await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'Verão', ...period });
    expect(res.statusCode).toBe(201);
    expect(res.json().campaign).toMatchObject({ status: 'draft', kind: 'commercial', frequencyLevel: 'high', partnerId: s.partnerA.id });
  });

  it('advertiser creates for itself and cannot pick another advertiser', async () => {
    const res = await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Minha', ...period });
    expect(res.statusCode).toBe(201);
    expect((await req('POST', '/api/campaigns', advCookie, { advertiserId: advA, planId: planA, name: 'X', ...period })).statusCode).toBe(400);
  });

  it('rejects plans of another partner, inactive plans and bad periods', async () => {
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planB, name: 'X', ...period })).json()).toEqual({ error: 'invalid_plan' });
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'X', startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' })).json()).toEqual({ error: 'invalid_period' });
    expect((await req('POST', '/api/campaigns', s.gerenteB, { advertiserId: advA, planId: planB, name: 'X', ...period })).statusCode).toBe(404);
  });
});

describe('approval flow', () => {
  it('submit → request changes → resubmit → approve, with history', async () => {
    const id = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Fluxo', ...period })).json().campaign.id;
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json()).toEqual({ error: 'media_required' });
    expect((await uploadPng(id, advCookie)).statusCode).toBe(201);
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json().campaign.status).toBe('pending_review');
    expect((await req('PATCH', `/api/campaigns/${id}`, advCookie, { name: 'mudou' })).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${id}/approve`, advCookie)).statusCode).toBe(403);
    expect((await req('POST', `/api/campaigns/${id}/request-changes`, s.gerenteA, {})).statusCode).toBe(400);
    expect((await req('POST', `/api/campaigns/${id}/request-changes`, s.gerenteA, { reason: 'Logo cortado' })).json().campaign.status).toBe('changes_requested');
    expect((await uploadPng(id, advCookie)).statusCode).toBe(201);
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json().campaign.status).toBe('pending_review');
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA)).json().campaign.status).toBe('approved');
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });

    const detail = (await req('GET', `/api/campaigns/${id}`, advCookie)).json();
    expect(detail.reviews.map((r: { action: string }) => r.action)).toEqual(['submitted', 'changes_requested', 'submitted', 'approved']);
    expect(detail.reviews[1].reason).toBe('Logo cortado');
    expect(detail.campaign.effectiveStatus).toBe('active');
    expect(detail.media.mediaType).toBe('image');
  });

  it('partner can cancel; cancelled cannot be resubmitted', async () => {
    const id = (await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'Cancelar', ...period })).json().campaign.id;
    expect((await req('POST', `/api/campaigns/${id}/cancel`, s.gerenteA)).json().campaign.status).toBe('cancelled');
    expect((await req('POST', `/api/campaigns/${id}/cancel`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${id}/submit`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
  });
});

describe('isolation', () => {
  it('other partners get 404 and advertisers only see their own campaigns', async () => {
    const id = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Privada', ...period })).json().campaign.id;
    expect((await req('GET', `/api/campaigns/${id}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('GET', `/api/campaigns/${id}`, advOtherCookie)).statusCode).toBe(404);
    const otherList = (await req('GET', '/api/campaigns', advOtherCookie)).json().campaigns as { id: string }[];
    expect(otherList.map((c) => c.id)).not.toContain(id);
    const partnerList = (await req('GET', '/api/campaigns', s.gerenteA)).json().campaigns as { id: string }[];
    expect(partnerList.map((c) => c.id)).toContain(id);
    expect((await req('GET', '/api/campaigns', s.gerenteB)).json().campaigns).toEqual([]);
  });
});

describe('effectiveStatus', () => {
  it('derives scheduled, active and ended for approved campaigns only', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const c = (status: 'approved' | 'draft', startsAt: string, endsAt: string) => ({ status, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    expect(effectiveStatus(c('approved', '2026-07-01', '2026-08-01'), now)).toBe('scheduled');
    expect(effectiveStatus(c('approved', '2026-05-01', '2026-08-01'), now)).toBe('active');
    expect(effectiveStatus(c('approved', '2026-01-01', '2026-06-01'), now)).toBe('ended');
    expect(effectiveStatus(c('draft', '2026-05-01', '2026-08-01'), now)).toBe('draft');
  });

  it('is stored as approved in the database', async () => {
    const rows = await t.db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.status, 'approved'));
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

Run: `pnpm --filter @midora/api test -- campaigns`
Expected: FAIL — `../src/campaigns/status` inexistente; rotas 404.

(O upload usado neste teste é implementado na Task 5; nesta task o teste `approval flow` fica vermelho até lá. Rodar a Task 4 com `-t "creating campaigns|isolation|effectiveStatus"` e o arquivo inteiro ao final da Task 5.)

- [ ] **Step 2: Implementação**

`apps/api/src/campaigns/status.ts`:
```ts
import type { CampaignStatus } from '../db/schema';

export type EffectiveStatus = CampaignStatus | 'scheduled' | 'active' | 'ended';

export function effectiveStatus(
  c: { status: CampaignStatus; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EffectiveStatus {
  if (c.status !== 'approved') return c.status;
  if (now < c.startsAt) return 'scheduled';
  if (now >= c.endsAt) return 'ended';
  return 'active';
}
```

`apps/api/src/campaigns/routes.ts`:
```ts
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { advertisers, campaignReviews, campaigns, media, plans, type CampaignStatus } from '../db/schema';
import { parse } from '../http/validation';
import { attachMedia } from '../media/attach';
import { receiveUpload, type UploadLimits } from '../media/upload';
import type { LocalStorage } from '../storage/local';
import { effectiveStatus } from './status';

const IdParams = z.object({ id: z.uuid() });
const DateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const CreateCampaign = z
  .object({
    advertiserId: z.uuid().optional(),
    planId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    startsAt: DateTime,
    endsAt: DateTime,
  })
  .strict();
const UpdateCampaign = z
  .object({ name: z.string().trim().min(1).max(120), planId: z.uuid(), startsAt: DateTime, endsAt: DateTime })
  .partial()
  .strict();
const RequestChanges = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

const EDITABLE: CampaignStatus[] = ['draft', 'changes_requested'];

type Campaign = typeof campaigns.$inferSelect;

function scope(user: SessionUser): SQL {
  return user.role === 'advertiser'
    ? eq(campaigns.advertiserId, user.advertiserId!)
    : eq(campaigns.partnerId, user.partnerId!);
}

export async function loadScopedCampaign(db: Db, user: SessionUser, id: string): Promise<Campaign | undefined> {
  const [c] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.kind, 'commercial'), scope(user)));
  return c;
}

/** Atomic status change + history row. Returns undefined when the campaign is not in `from`. */
export async function transition(
  db: Db,
  opts: { id: string; from: CampaignStatus[]; to: CampaignStatus; action: 'submitted' | 'approved' | 'changes_requested' | 'cancelled'; actorUserId: string; reason?: string },
): Promise<Campaign | undefined> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(campaigns)
      .set({ status: opts.to, updatedAt: new Date() })
      .where(and(eq(campaigns.id, opts.id), inArray(campaigns.status, opts.from)))
      .returning();
    if (!c) return undefined;
    await tx.insert(campaignReviews).values({
      campaignId: c.id, action: opts.action, reason: opts.reason ?? null, actorUserId: opts.actorUserId,
    });
    return c;
  });
}

const withStatus = (c: Campaign) => ({ ...c, effectiveStatus: effectiveStatus(c) });

export const campaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits }> = async (
  app,
  { db, storage, uploadLimits },
) => {
  const anyOwner = { preHandler: requireRole('partner_user', 'advertiser') };
  const partnerOnly = { preHandler: requireRole('partner_user') };

  const activePlan = async (partnerId: string, planId: string) => {
    const [p] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.partnerId, partnerId), eq(plans.active, true)));
    return p;
  };

  app.get('/api/campaigns', anyOwner, async (req) => {
    const rows = await db.select().from(campaigns).where(and(eq(campaigns.kind, 'commercial'), scope(req.user!))).orderBy(desc(campaigns.createdAt));
    return { campaigns: rows.map(withStatus) };
  });

  app.get('/api/campaigns/:id', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const [current] = c.currentMediaId ? await db.select().from(media).where(eq(media.id, c.currentMediaId)) : [];
    const reviews = await db
      .select({ action: campaignReviews.action, reason: campaignReviews.reason, actorUserId: campaignReviews.actorUserId, createdAt: campaignReviews.createdAt })
      .from(campaignReviews)
      .where(eq(campaignReviews.campaignId, c.id))
      .orderBy(asc(campaignReviews.createdAt), asc(campaignReviews.id));
    return { campaign: withStatus(c), media: current ?? null, reviews };
  });

  app.post('/api/campaigns', anyOwner, async (req, reply) => {
    const body = parse(CreateCampaign, req.body, reply);
    if (!body) return reply;
    const user = req.user!;
    let advertiserId: string;
    if (user.role === 'advertiser') {
      if (body.advertiserId) return reply.code(400).send({ error: 'invalid_request' });
      advertiserId = user.advertiserId!;
    } else {
      if (!body.advertiserId) return reply.code(400).send({ error: 'invalid_request' });
      const [adv] = await db
        .select({ id: advertisers.id })
        .from(advertisers)
        .where(and(eq(advertisers.id, body.advertiserId), eq(advertisers.partnerId, user.partnerId!)));
      if (!adv) return reply.code(404).send({ error: 'not_found' });
      advertiserId = adv.id;
    }
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ error: 'invalid_period' });
    const plan = await activePlan(user.partnerId!, body.planId);
    if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        kind: 'commercial', partnerId: user.partnerId!, advertiserId, planId: plan.id, name: body.name,
        startsAt: body.startsAt, endsAt: body.endsAt, frequencyLevel: plan.frequencyLevel,
      })
      .returning();
    return reply.code(201).send({ campaign: withStatus(campaign!) });
  });

  app.patch('/api/campaigns/:id', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateCampaign, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (!EDITABLE.includes(c.status)) return reply.code(409).send({ error: 'invalid_state' });
    const startsAt = body.startsAt ?? c.startsAt;
    const endsAt = body.endsAt ?? c.endsAt;
    if (endsAt <= startsAt) return reply.code(400).send({ error: 'invalid_period' });
    let frequencyLevel = c.frequencyLevel;
    if (body.planId) {
      const plan = await activePlan(c.partnerId!, body.planId);
      if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
      frequencyLevel = plan.frequencyLevel;
    }
    const [campaign] = await db
      .update(campaigns)
      .set({ ...body, frequencyLevel, updatedAt: new Date() })
      .where(and(eq(campaigns.id, c.id), inArray(campaigns.status, EDITABLE)))
      .returning();
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/media', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    if (!storage || !uploadLimits) return reply.code(503).send({ error: 'storage_unavailable' });
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (!EDITABLE.includes(c.status)) return reply.code(409).send({ error: 'invalid_state' });
    const upload = await receiveUpload(req, storage, uploadLimits);
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error });
    const result = await attachMedia(db, storage, c, upload, { allowedStatuses: EDITABLE });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return reply.code(201).send({ media: result });
  });

  app.post('/api/campaigns/:id/submit', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (EDITABLE.includes(c.status) && !c.currentMediaId) return reply.code(409).send({ error: 'media_required' });
    const campaign = await transition(db, { id: c.id, from: EDITABLE, to: 'pending_review', action: 'submitted', actorUserId: req.user!.id });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/approve', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, { id: c.id, from: ['pending_review'], to: 'approved', action: 'approved', actorUserId: req.user!.id });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/request-changes', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(RequestChanges, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['pending_review'], to: 'changes_requested', action: 'changes_requested', actorUserId: req.user!.id, reason: body.reason,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/cancel', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['draft', 'pending_review', 'changes_requested', 'approved'], to: 'cancelled', action: 'cancelled', actorUserId: req.user!.id,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });
};
```

Para compilar já nesta task, criar `apps/api/src/media/attach.ts` e completar `apps/api/src/media/upload.ts` conforme a Task 5 (Steps 2–3). Ordem prática: implementar a Task 5 Step 3 (upload/attach) junto com esta task; os testes de mídia da Task 5 continuam sendo escritos primeiro na Task 5.

`apps/api/src/app.ts`: registrar após `publicRoutes`:
```ts
    await app.register(campaignRoutes, { db: opts.db, storage: opts.storage, uploadLimits: opts.uploadLimits });
```

- [ ] **Step 3: Rodar**

Run: `pnpm --filter @midora/api test -- campaigns -t "creating campaigns|isolation|effectiveStatus" && pnpm typecheck`
Expected: PASS nesses grupos.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): add commercial campaigns with approval workflow and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Upload, entrega de mídia e campanhas institucionais

**Files:**
- Create: `apps/api/src/media/attach.ts`, `apps/api/src/media/routes.ts`, `apps/api/src/campaigns/admin-routes.ts`, `apps/api/test/media-routes.test.ts`
- Modify: `apps/api/src/media/upload.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `LocalStorage`, `detectImageMime`, `isMp4`, `probeMp4`, `campaigns`, `media`, `partners`, `transition`.
- Produces:
  - `receiveUpload(req, storage, limits): Promise<UploadOk | UploadFail>` com `UploadOk = { ok: true; tmpPath; mediaType: 'image' | 'video'; mime; ext; sizeBytes; sha256; durationMs: number | null; fields: Record<string, string> }`, `UploadFail = { ok: false; status: 400 | 413 | 415; error: string }` — remove o temporário em qualquer falha
  - `attachMedia(db, storage, campaign, upload, { allowedStatuses }): Promise<Media | undefined>`
  - `mediaRoutes` — `GET /api/media/:id` (Range, ETag, 304)
  - `adminCampaignRoutes` — `GET|POST /api/admin/campaigns`, `POST /api/admin/campaigns/:id/media`, `POST /api/admin/campaigns/:id/cancel`

- [ ] **Step 1: Testes que falham**

`apps/api/test/media-routes.test.ts`:
```ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, multipart, seed } from './helpers/app';
import { login, createUser } from './helpers/fixtures';
import { PNG_BYTES, buildMp4 } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let campaignId: string;

const req = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...headers }, payload: payload as object });

const upload = (url: string, cookie: string, file: { filename: string; contentType: string; data: Buffer }, fields?: Record<string, string>) => {
  const m = multipart(file, fields);
  return t.app.inject({ method: 'POST', url, headers: { cookie, ...m.headers }, payload: m.payload });
};

const tmpFiles = () => readdir(join(t.storage.root, 'tmp'));

beforeAll(async () => {
  t = await createTestApp({ maxImageBytes: 1024, maxVideoBytes: 64 * 1024 });
  s = await seed(t.app, t.db);
  const plan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'P', frequencyLevel: 'medium' })).json().plan.id;
  const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'A' })).json().advertiser.id;
  campaignId = (await req('POST', '/api/campaigns', s.gerenteA, {
    advertiserId: adv, planId: plan, name: 'Mídia', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
});
afterAll(() => t.close());

describe('upload validation', () => {
  it('accepts a PNG with display seconds and a valid H.264 MP4', async () => {
    const img = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES }, { displaySeconds: '15' });
    expect(img.statusCode).toBe(201);
    expect(img.json().media).toMatchObject({ mediaType: 'image', mime: 'image/png', displaySeconds: 15, durationMs: null });

    const vid = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: buildMp4({ durationMs: 12000 }) });
    expect(vid.statusCode).toBe(201);
    expect(vid.json().media).toMatchObject({ mediaType: 'video', mime: 'video/mp4', durationMs: 12000, displaySeconds: null });
  });

  it('uses the partner default image duration', async () => {
    const img = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES });
    expect(img.json().media.displaySeconds).toBe(10);
  });

  it('rejects fake, HEVC and oversized files without leaving temp files', async () => {
    const fake = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: Buffer.from('this is plain text, not a video') });
    expect(fake.statusCode).toBe(415);
    const hevc = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'h.mp4', contentType: 'video/mp4', data: buildMp4({ video: 'hvc1' }) });
    expect(hevc.json()).toEqual({ error: 'unsupported_media' });
    const big = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'big.png', contentType: 'image/png', data: Buffer.concat([PNG_BYTES, Buffer.alloc(4096)]) });
    expect(big.json()).toEqual({ error: 'file_too_large' });
    const tooLong = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: Buffer.concat([buildMp4(), Buffer.alloc(80 * 1024)]) });
    expect(tooLong.json()).toEqual({ error: 'file_too_large' });
    const bad = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES }, { displaySeconds: '0' });
    expect(bad.statusCode).toBe(400);
    expect(await tmpFiles()).toEqual([]);
  });

  it('requires a multipart file', async () => {
    expect((await req('POST', `/api/campaigns/${campaignId}/media`, s.gerenteA, { a: 1 })).json()).toEqual({ error: 'file_required' });
  });
});

describe('media delivery', () => {
  let mediaId: string;
  let size: number;
  beforeAll(async () => {
    const data = buildMp4({ durationMs: 3000 });
    size = data.length;
    mediaId = (await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data })).json().media.id;
  });

  it('serves the whole file with cache headers and supports ETag', async () => {
    const res = await req('GET', `/api/media/${mediaId}`, s.gerenteA);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(size);
    expect(res.rawPayload.length).toBe(size);
    const etag = res.headers.etag as string;
    expect((await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { 'if-none-match': etag })).statusCode).toBe(304);
  });

  it('serves byte ranges and rejects invalid ones', async () => {
    const a = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: 'bytes=0-9' });
    expect(a.statusCode).toBe(206);
    expect(a.headers['content-range']).toBe(`bytes 0-9/${size}`);
    expect(a.rawPayload.length).toBe(10);
    const b = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: 'bytes=-5' });
    expect(b.headers['content-range']).toBe(`bytes ${size - 5}-${size - 1}/${size}`);
    const c = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: `bytes=${size - 3}-` });
    expect(c.rawPayload.length).toBe(3);
    const d = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: `bytes=${size + 10}-` });
    expect(d.statusCode).toBe(416);
    expect(d.headers['content-range']).toBe(`bytes */${size}`);
  });

  it('is visible to the same partner and its player, not to other partners', async () => {
    await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
    const tv = await login(t.app, 'tv@parceiro-a', 'senha-tv-123');
    expect((await req('GET', `/api/media/${mediaId}`, tv)).statusCode).toBe(200);
    expect((await req('GET', `/api/media/${mediaId}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('GET', `/api/media/${mediaId}`)).statusCode).toBe(401);
  });
});

describe('institutional campaigns', () => {
  it('admin creates an approved institutional campaign with media; partners cannot', async () => {
    const res = await req('POST', '/api/admin/campaigns', s.admin, {
      name: 'Anuncie aqui', frequencyLevel: 'low', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().campaign).toMatchObject({ kind: 'institutional', status: 'approved', partnerId: null });
    const id = res.json().campaign.id;
    const m = await upload(`/api/admin/campaigns/${id}/media`, s.admin, { filename: 'i.png', contentType: 'image/png', data: PNG_BYTES });
    expect(m.statusCode).toBe(201);
    expect(m.json().media.partnerId).toBeNull();
    expect((await req('GET', `/api/media/${m.json().media.id}`, s.gerenteB)).statusCode).toBe(200);
    expect((await req('POST', '/api/admin/campaigns', s.gerenteA, { name: 'x', frequencyLevel: 'low', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })).statusCode).toBe(403);
    expect((await req('POST', `/api/admin/campaigns/${id}/cancel`, s.admin)).json().campaign.status).toBe('cancelled');
    expect((await req('GET', '/api/admin/campaigns', s.admin)).json().campaigns.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('advertisers only see media of their own campaigns', async () => {
    await createUser(t.db, { email: 'unused@x.com', password: 'senha-forte-1', role: 'admin' });
    const signup = await req('POST', '/api/public/partners/parceiro-a/advertisers', undefined, {
      companyName: 'Outra', contactName: 'O', email: 'o@x.com', password: 'senha-anunc-1',
    });
    const cookie = `midora_session=${signup.cookies.find((c) => c.name === 'midora_session')!.value}`;
    const list = (await req('GET', `/api/campaigns/${campaignId}`, s.gerenteA)).json();
    expect((await req('GET', `/api/media/${list.media.id}`, cookie)).statusCode).toBe(404);
  });
});
```

Run: `pnpm --filter @midora/api test -- media-routes`
Expected: FAIL (rotas e upload inexistentes).

- [ ] **Step 2: Upload**

`apps/api/src/media/upload.ts` (substitui o arquivo da Task 3):
```ts
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import type { LocalStorage } from '../storage/local';
import { detectImageMime, isMp4 } from './detect';
import { probeMp4 } from './mp4';

export interface UploadLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
}

export type UploadOk = {
  ok: true;
  tmpPath: string;
  mediaType: 'image' | 'video';
  mime: string;
  ext: string;
  sizeBytes: number;
  sha256: string;
  durationMs: number | null;
  fields: Record<string, string>;
};
export type UploadFail = { ok: false; status: 400 | 413 | 415; error: string };

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_CODECS = new Set(['avc1', 'avc3']);

export async function receiveUpload(
  req: FastifyRequest,
  storage: LocalStorage,
  limits: UploadLimits,
): Promise<UploadOk | UploadFail> {
  if (!req.isMultipart()) return { ok: false, status: 400, error: 'file_required' };
  const part = await req.file({ limits: { fileSize: Math.max(limits.maxImageBytes, limits.maxVideoBytes), files: 1 } });
  if (!part) return { ok: false, status: 400, error: 'file_required' };

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(part.fields)) {
    const f = Array.isArray(value) ? value[0] : value;
    if (f && f.type === 'field') fields[name] = String(f.value);
  }

  const tmpPath = storage.tmpPath();
  const fail = async (status: UploadFail['status'], error: string): Promise<UploadFail> => {
    await rm(tmpPath, { force: true });
    return { ok: false, status, error };
  };

  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(part.file, hasher, createWriteStream(tmpPath));
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return fail(413, 'file_too_large');
    await rm(tmpPath, { force: true });
    throw err;
  }
  if (part.file.truncated) return fail(413, 'file_too_large');

  const { size } = await stat(tmpPath);
  const head = Buffer.alloc(16);
  const fh = await open(tmpPath, 'r');
  await fh.read(head, 0, 16, 0);
  await fh.close();
  const base = { ok: true as const, tmpPath, sizeBytes: size, sha256: hash.digest('hex'), fields };

  const imageMime = detectImageMime(head);
  if (imageMime) {
    if (size > limits.maxImageBytes) return fail(413, 'file_too_large');
    return { ...base, mediaType: 'image', mime: imageMime, ext: IMAGE_EXT[imageMime]!, durationMs: null };
  }
  if (isMp4(head)) {
    if (size > limits.maxVideoBytes) return fail(413, 'file_too_large');
    try {
      const info = await probeMp4(tmpPath);
      const ok =
        info.durationMs > 0 &&
        info.videoCodec !== null &&
        VIDEO_CODECS.has(info.videoCodec) &&
        (info.audioCodec === null || info.audioCodec === 'mp4a');
      if (!ok) return fail(415, 'unsupported_media');
      return { ...base, mediaType: 'video', mime: 'video/mp4', ext: 'mp4', durationMs: info.durationMs };
    } catch {
      return fail(415, 'unsupported_media');
    }
  }
  return fail(415, 'unsupported_media');
}
```

`apps/api/src/media/attach.ts`:
```ts
import { rm } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { campaigns, media, partners, type CampaignStatus } from '../db/schema';
import type { LocalStorage } from '../storage/local';
import type { UploadOk } from './upload';

type Campaign = typeof campaigns.$inferSelect;
export type Media = typeof media.$inferSelect;

/** Stores the uploaded file, records it and makes it the campaign's current media. */
export async function attachMedia(
  db: Db,
  storage: LocalStorage,
  campaign: Campaign,
  upload: UploadOk,
  { allowedStatuses }: { allowedStatuses: CampaignStatus[] },
): Promise<Media | undefined | 'invalid_display_seconds'> {
  let displaySeconds: number | null = null;
  if (upload.mediaType === 'image') {
    if (upload.fields.displaySeconds !== undefined) {
      const n = Number(upload.fields.displaySeconds);
      if (!Number.isInteger(n) || n < 1 || n > 3600) {
        await rm(upload.tmpPath, { force: true });
        return 'invalid_display_seconds';
      }
      displaySeconds = n;
    } else if (campaign.partnerId) {
      const [p] = await db.select({ s: partners.defaultImageSeconds }).from(partners).where(eq(partners.id, campaign.partnerId));
      displaySeconds = p?.s ?? 10;
    } else {
      displaySeconds = 10;
    }
  }

  const id = crypto.randomUUID();
  const key = `${campaign.partnerId ?? 'institutional'}/${id}.${upload.ext}`;
  await storage.saveFrom(upload.tmpPath, key);
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaign.id), inArray(campaigns.status, allowedStatuses)))
        .for('update');
      if (!current) throw new Error('state_changed');
      const [row] = await tx
        .insert(media)
        .values({
          id, partnerId: campaign.partnerId, campaignId: campaign.id, storageKey: key, mediaType: upload.mediaType,
          mime: upload.mime, sizeBytes: upload.sizeBytes, durationMs: upload.durationMs, sha256: upload.sha256, displaySeconds,
        })
        .returning();
      await tx.update(campaigns).set({ currentMediaId: id, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      return row;
    });
  } catch (err) {
    await storage.remove(key);
    if ((err as Error).message === 'state_changed') return undefined;
    throw err;
  }
}
```

Nas rotas de upload (comercial na Task 4 e institucional abaixo), tratar o retorno `'invalid_display_seconds'` → `400 { error: 'invalid_request' }` antes de `undefined` → 409. Em `campaigns/routes.ts`, substituir o trecho final da rota de mídia por:
```ts
    const result = await attachMedia(db, storage, c, upload, { allowedStatuses: EDITABLE });
    if (result === 'invalid_display_seconds') return reply.code(400).send({ error: 'invalid_request' });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return reply.code(201).send({ media: result });
```

- [ ] **Step 3: Entrega e institucionais**

`apps/api/src/media/routes.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { ROLES, campaigns, media } from '../db/schema';
import { parse } from '../http/validation';
import type { LocalStorage } from '../storage/local';

const IdParams = z.object({ id: z.uuid() });

function canRead(user: SessionUser, m: { partnerId: string | null }, advertiserId: string | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'advertiser') return advertiserId !== null && advertiserId === user.advertiserId;
  // partner users and players: own partner's media, plus Midora institutional media
  return m.partnerId === null || m.partnerId === user.partnerId;
}

export const mediaRoutes: FastifyPluginAsync<{ db: Db; storage: LocalStorage }> = async (app, { db, storage }) => {
  app.get('/api/media/:id', { preHandler: requireRole(...ROLES) }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const [row] = await db
      .select({ m: media, advertiserId: campaigns.advertiserId })
      .from(media)
      .innerJoin(campaigns, eq(campaigns.id, media.campaignId))
      .where(eq(media.id, params.id));
    if (!row || !canRead(req.user!, row.m, row.advertiserId)) return reply.code(404).send({ error: 'not_found' });
    const m = row.m;
    const size = m.sizeBytes;
    const etag = `"${m.sha256}"`;
    reply
      .header('content-type', m.mime)
      .header('accept-ranges', 'bytes')
      .header('etag', etag)
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const range = req.headers.range;
    if (!range) {
      reply.header('content-length', size);
      return reply.send(storage.createReadStream(m.storageKey));
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = -1;
    let end = -1;
    if (match && (match[1] !== '' || match[2] !== '')) {
      if (match[1] === '') {
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
      }
    }
    if (start < 0 || start > end || start >= size) {
      return reply.code(416).header('content-range', `bytes */${size}`).send();
    }
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
    return reply.send(storage.createReadStream(m.storageKey, { start, end }));
  });
};
```

`apps/api/src/campaigns/admin-routes.ts`:
```ts
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { FREQUENCY_LEVELS, campaigns } from '../db/schema';
import { parse } from '../http/validation';
import { attachMedia } from '../media/attach';
import { receiveUpload, type UploadLimits } from '../media/upload';
import type { LocalStorage } from '../storage/local';
import { transition } from './routes';
import { effectiveStatus } from './status';

const IdParams = z.object({ id: z.uuid() });
const DateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const CreateInstitutional = z
  .object({ name: z.string().trim().min(1).max(120), frequencyLevel: z.enum(FREQUENCY_LEVELS), startsAt: DateTime, endsAt: DateTime })
  .strict();

type Campaign = typeof campaigns.$inferSelect;
const withStatus = (c: Campaign) => ({ ...c, effectiveStatus: effectiveStatus(c) });

export const adminCampaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits }> = async (
  app,
  { db, storage, uploadLimits },
) => {
  app.addHook('preHandler', requireRole('admin'));

  const load = async (id: string) => {
    const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.kind, 'institutional')));
    return c;
  };

  app.get('/api/admin/campaigns', async () => ({
    campaigns: (await db.select().from(campaigns).where(eq(campaigns.kind, 'institutional')).orderBy(desc(campaigns.createdAt))).map(withStatus),
  }));

  app.post('/api/admin/campaigns', async (req, reply) => {
    const body = parse(CreateInstitutional, req.body, reply);
    if (!body) return reply;
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ error: 'invalid_period' });
    const [campaign] = await db.insert(campaigns).values({ ...body, kind: 'institutional', status: 'approved' }).returning();
    return reply.code(201).send({ campaign: withStatus(campaign!) });
  });

  app.post('/api/admin/campaigns/:id/media', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    if (!storage || !uploadLimits) return reply.code(503).send({ error: 'storage_unavailable' });
    const c = await load(params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const upload = await receiveUpload(req, storage, uploadLimits);
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error });
    const result = await attachMedia(db, storage, c, upload, { allowedStatuses: ['approved'] });
    if (result === 'invalid_display_seconds') return reply.code(400).send({ error: 'invalid_request' });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return reply.code(201).send({ media: result });
  });

  app.post('/api/admin/campaigns/:id/cancel', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await load(params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, { id: c.id, from: ['approved'], to: 'cancelled', action: 'cancelled', actorUserId: req.user!.id });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });
};
```

`apps/api/src/app.ts` — registrar multipart e as rotas (dentro de `if (opts.db)`):
```ts
    await app.register(multipart);
    await app.register(campaignRoutes, { db: opts.db, storage: opts.storage, uploadLimits: opts.uploadLimits });
    await app.register(adminCampaignRoutes, { db: opts.db, storage: opts.storage, uploadLimits: opts.uploadLimits });
    if (opts.storage) await app.register(mediaRoutes, { db: opts.db, storage: opts.storage });
```
(`import multipart from '@fastify/multipart'`). Remover o registro duplicado de `campaignRoutes` feito na Task 4.

- [ ] **Step 4: Rodar tudo**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: todos PASS, incluindo `campaigns.test.ts` inteiro e `media-routes.test.ts` (11 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add validated media upload, ranged delivery and institutional campaigns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Elegibilidade, guarda de rotas e configuração de produção

**Files:**
- Create: `apps/api/src/campaigns/eligibility.ts`, `apps/api/test/eligibility.test.ts`, `apps/api/test/guard.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/test/config.test.ts`, `apps/api/src/server.ts`, `Dockerfile`

**Interfaces:**
- Produces:
  - `interface EligibleItem { campaignId: string; kind: 'commercial' | 'institutional'; name: string; frequencyLevel: FrequencyLevel; media: { id: string; mediaType: 'image' | 'video'; mime: string; sha256: string; sizeBytes: number; durationMs: number | null; displaySeconds: number | null } }`
  - `listEligible(db: Db, partnerId: string, now?: Date): Promise<EligibleItem[]>` (consumido pela Etapa 3)
  - `Config` ganha `mediaDir: string` (`MEDIA_DIR`, padrão `./data/media`), `maxImageMb: number` (`MAX_IMAGE_MB`, 10), `maxVideoMb: number` (`MAX_VIDEO_MB`, 200)

- [ ] **Step 1: Testes que falham**

`apps/api/test/eligibility.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listEligible } from '../src/campaigns/eligibility';
import type { Db } from '../src/db/client';
import { advertisers, campaigns, media, partners, plans } from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { createPartner } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
const now = new Date('2026-06-15T12:00:00Z');

async function makeCampaign(opts: {
  partnerId: string | null; status: 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'cancelled';
  startsAt?: string; endsAt?: string; withMedia?: boolean; name: string;
}) {
  let advertiserId: string | null = null;
  let planId: string | null = null;
  if (opts.partnerId) {
    advertiserId = (await db.insert(advertisers).values({ partnerId: opts.partnerId, name: 'A', source: 'manual' }).returning())[0]!.id;
    planId = (await db.insert(plans).values({ partnerId: opts.partnerId, name: 'P', frequencyLevel: 'medium' }).returning())[0]!.id;
  }
  const [c] = await db.insert(campaigns).values({
    kind: opts.partnerId ? 'commercial' : 'institutional', partnerId: opts.partnerId, advertiserId, planId, name: opts.name,
    status: opts.status, frequencyLevel: 'medium',
    startsAt: new Date(opts.startsAt ?? '2026-06-01T00:00:00Z'), endsAt: new Date(opts.endsAt ?? '2026-07-01T00:00:00Z'),
  }).returning();
  if (opts.withMedia ?? true) {
    const [m] = await db.insert(media).values({
      partnerId: opts.partnerId, campaignId: c!.id, storageKey: `k/${c!.id}`, mediaType: 'video', mime: 'video/mp4',
      sizeBytes: 100, durationMs: 15000, sha256: 'abc', displaySeconds: null,
    }).returning();
    await db.update(campaigns).set({ currentMediaId: m!.id }).where(eq(campaigns.id, c!.id));
  }
  return c!;
}

let pA: string;
let pB: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  pA = (await createPartner(db, 'a')).id;
  pB = (await createPartner(db, 'b')).id;
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'ok' });
  await makeCampaign({ partnerId: pA, status: 'draft', name: 'draft' });
  await makeCampaign({ partnerId: pA, status: 'pending_review', name: 'pending' });
  await makeCampaign({ partnerId: pA, status: 'changes_requested', name: 'changes' });
  await makeCampaign({ partnerId: pA, status: 'cancelled', name: 'cancelled' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'future', startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-08-01T00:00:00Z' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'past', startsAt: '2026-05-01T00:00:00Z', endsAt: '2026-06-15T12:00:00Z' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'nomedia', withMedia: false });
  await makeCampaign({ partnerId: pB, status: 'approved', name: 'other-partner' });
  await makeCampaign({ partnerId: null, status: 'approved', name: 'institutional' });
});
afterAll(() => close());

describe('listEligible', () => {
  it('returns only approved, in-period campaigns with media of the partner', async () => {
    const items = await listEligible(db, pA, now);
    expect(items.map((i) => i.name)).toEqual(['ok']);
    expect(items[0]).toMatchObject({ kind: 'commercial', frequencyLevel: 'medium', media: { mediaType: 'video', durationMs: 15000 } });
  });

  it('adds institutional campaigns only when the partner allows them', async () => {
    await db.update(partners).set({ showInstitutional: true }).where(eq(partners.id, pA));
    expect((await listEligible(db, pA, now)).map((i) => i.name).sort()).toEqual(['institutional', 'ok']);
    expect((await listEligible(db, pB, now)).map((i) => i.name)).toEqual(['other-partner']);
  });

  it('returns nothing for inactive partners', async () => {
    await db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, pB));
    expect(await listEligible(db, pB, now)).toEqual([]);
  });
});
```

`apps/api/test/guard.test.ts`:
```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(() => t.close());

const ID = '00000000-0000-4000-8000-000000000000';
const PROTECTED: [string, string][] = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/admin/partners'], ['POST', '/api/admin/partners'], ['PATCH', `/api/admin/partners/${ID}`],
  ['POST', `/api/admin/partners/${ID}/users`],
  ['GET', '/api/partner'], ['GET', '/api/partner/users'], ['PUT', '/api/partner/player-account'],
  ['GET', '/api/partner/advertisers'], ['POST', '/api/partner/advertisers'], ['PATCH', `/api/partner/advertisers/${ID}`],
  ['GET', '/api/partner/plans'], ['POST', '/api/partner/plans'], ['PATCH', `/api/partner/plans/${ID}`],
  ['GET', '/api/advertiser'],
  ['GET', '/api/campaigns'], ['POST', '/api/campaigns'], ['GET', `/api/campaigns/${ID}`], ['PATCH', `/api/campaigns/${ID}`],
  ['POST', `/api/campaigns/${ID}/media`], ['POST', `/api/campaigns/${ID}/submit`], ['POST', `/api/campaigns/${ID}/approve`],
  ['POST', `/api/campaigns/${ID}/request-changes`], ['POST', `/api/campaigns/${ID}/cancel`],
  ['GET', '/api/admin/campaigns'], ['POST', '/api/admin/campaigns'], ['POST', `/api/admin/campaigns/${ID}/media`],
  ['POST', `/api/admin/campaigns/${ID}/cancel`],
  ['GET', `/api/media/${ID}`],
];

it.each(PROTECTED)('%s %s requires a session', async (method, url) => {
  const res = await t.app.inject({ method: method as 'GET', url, payload: method === 'GET' ? undefined : {} });
  expect(res.statusCode).toBe(401);
});
```

`apps/api/test/config.test.ts`: nos dois primeiros testes acrescentar os campos — `defaults`: `mediaDir: './data/media', maxImageMb: 10, maxVideoMb: 200`; `env`: entradas `MEDIA_DIR: '/data/media', MAX_IMAGE_MB: '5', MAX_VIDEO_MB: '100'` e expectativas `mediaDir: '/data/media', maxImageMb: 5, maxVideoMb: 100`. E um teste novo:
```ts
  it('rejects invalid upload limits', () => {
    expect(() => loadConfig({ MAX_VIDEO_MB: '0' })).toThrow('Invalid MAX_VIDEO_MB: 0');
    expect(() => loadConfig({ MAX_IMAGE_MB: 'x' })).toThrow('Invalid MAX_IMAGE_MB: x');
  });
```

Run: `pnpm --filter @midora/api test -- eligibility guard config`
Expected: FAIL (`eligibility` inexistente; campos de config ausentes). Rotas da guarda já devem dar 401 — se alguma der 404/403/400, é exatamente a falha que o teste existe para pegar: corrigir a rota.

- [ ] **Step 2: Implementação**

`apps/api/src/campaigns/eligibility.ts`:
```ts
import { and, asc, eq, gt, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { campaigns, media, partners, type FrequencyLevel } from '../db/schema';

export interface EligibleItem {
  campaignId: string;
  kind: 'commercial' | 'institutional';
  name: string;
  frequencyLevel: FrequencyLevel;
  media: {
    id: string;
    mediaType: 'image' | 'video';
    mime: string;
    sha256: string;
    sizeBytes: number;
    durationMs: number | null;
    displaySeconds: number | null;
  };
}

/** Campaigns a partner's TVs may play right now (spec §8). */
export async function listEligible(db: Db, partnerId: string, now: Date = new Date()): Promise<EligibleItem[]> {
  const [partner] = await db
    .select({ status: partners.status, showInstitutional: partners.showInstitutional })
    .from(partners)
    .where(eq(partners.id, partnerId));
  if (!partner || partner.status !== 'active') return [];
  const owner = partner.showInstitutional
    ? or(eq(campaigns.partnerId, partnerId), eq(campaigns.kind, 'institutional'))
    : eq(campaigns.partnerId, partnerId);
  const rows = await db
    .select({
      campaignId: campaigns.id, kind: campaigns.kind, name: campaigns.name, frequencyLevel: campaigns.frequencyLevel,
      mediaId: media.id, mediaType: media.mediaType, mime: media.mime, sha256: media.sha256,
      sizeBytes: media.sizeBytes, durationMs: media.durationMs, displaySeconds: media.displaySeconds,
    })
    .from(campaigns)
    .innerJoin(media, eq(media.id, campaigns.currentMediaId))
    .where(and(owner, eq(campaigns.status, 'approved'), lte(campaigns.startsAt, now), gt(campaigns.endsAt, now)))
    .orderBy(asc(campaigns.createdAt));
  return rows.map((r) => ({
    campaignId: r.campaignId, kind: r.kind, name: r.name, frequencyLevel: r.frequencyLevel,
    media: {
      id: r.mediaId, mediaType: r.mediaType, mime: r.mime, sha256: r.sha256, sizeBytes: r.sizeBytes,
      durationMs: r.durationMs, displaySeconds: r.displaySeconds,
    },
  }));
}
```

`apps/api/src/config.ts` — campos novos em `Config` e em `loadConfig`:
```ts
  mediaDir: string;
  maxImageMb: number;
  maxVideoMb: number;
```
```ts
function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}
```
```ts
    mediaDir: env.MEDIA_DIR || './data/media',
    maxImageMb: positiveNumber(env, 'MAX_IMAGE_MB', 10),
    maxVideoMb: positiveNumber(env, 'MAX_VIDEO_MB', 200),
```

`apps/api/src/server.ts` — antes de `buildApp`:
```ts
const storage = new LocalStorage(config.mediaDir);
await storage.init();
```
e em `buildApp({...})`:
```ts
  storage,
  uploadLimits: { maxImageBytes: config.maxImageMb * 1024 * 1024, maxVideoBytes: config.maxVideoMb * 1024 * 1024 },
```
(`import { LocalStorage } from './storage/local'`). Também garantir que o limite de corpo do multipart acomode vídeos: em `app.ts`, `await app.register(multipart, { limits: { fileSize: opts.uploadLimits?.maxVideoBytes, files: 1, fields: 10 } })`.

`Dockerfile` — no estágio final, antes de `USER node`:
```dockerfile
ENV MEDIA_DIR=/data/media
RUN mkdir -p /data/media && chown node:node /data/media
```

- [ ] **Step 3: Rodar tudo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 4: Commit, push e CI**

```bash
git add apps/api Dockerfile
git commit -m "feat(api): add campaign eligibility, route guard test and media storage config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-2a-campanhas-api
```
Expected: CI `check` e `docker` verdes.

---

### Task 7: Volume de mídia no Coolify, deploy e documentação

**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Passo a passo do volume (usuário), antes do merge**

1. Coolify → aplicação `midora` → **Persistent Storage** → **+ Add** → **Volume Mount**.
2. Name: `midora-media`; Destination Path: `/data/media` → Save. (Não clicar em Redeploy.)

Verificar pelo MCP: `list_storages` da aplicação mostra o volume em `/data/media`.

- [ ] **Step 2: Merge (com aprovação) e deploy**

```bash
git checkout main
git merge --ff-only feat/etapa-2a-campanhas-api
git push origin main
```
Acompanhar `list_deployments` até `finished`.

- [ ] **Step 3: Verificar**

```bash
D=http://dincx9erqdqpi0tqapejhgqs.31.97.249.115.sslip.io
curl -s $D/api/health                                            # ok com a versão nova
curl -s -o /dev/null -w '%{http_code}\n' $D/api/campaigns          # 401
curl -s -o /dev/null -w '%{http_code}\n' $D/api/public/partners/nao-existe   # 404
ssh hostinger-claude 'docker exec $(docker ps -q --filter name=dincx9) sh -c "ls -ld /data/media /data/media/tmp"'  # dono node
```

- [ ] **Step 4: `docs/DEPLOY.md`**

Acrescentar após "Banco de dados":
````markdown
## Mídia

- Volume `midora-media` montado em `/data/media` (Persistent Storage da aplicação). Contém os arquivos enviados (`<partnerId>/<mediaId>.<ext>`, `institutional/...`) e `tmp/` para uploads em andamento.
- Limites: `MAX_IMAGE_MB` (padrão 10) e `MAX_VIDEO_MB` (padrão 200).
- Formatos aceitos: JPEG, PNG, WebP; MP4 com H.264 e áudio AAC (ou sem áudio).
- Backup do volume: pendente (definir junto com o destino externo de backups antes do piloto).
````
e na tabela de variáveis:
```markdown
| `MEDIA_DIR` | `/data/media` | definido na imagem; deve coincidir com o volume |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` | 10 / 200 | opcionais |
```

Commit e push na `main` (com aprovação):
```bash
git add docs/DEPLOY.md
git commit -m "docs: document media volume and upload limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

## Critério de aceite da Etapa 2a

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes local e no CI.
- Critérios 1–5 da especificação cobertos por testes de API: cadastro manual e autocadastro no mesmo modelo; upload de imagem/vídeo; aprovação, rejeição com motivo e reenvio; campanha não aprovada nunca elegível (`eligibility.test.ts`).
- Isolamento entre parceiros e entre anunciantes coberto; nenhuma rota protegida sem guarda (`guard.test.ts`).
- Produção: versão nova saudável, volume `/data/media` montado e gravável pelo usuário `node`.

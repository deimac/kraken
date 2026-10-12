# Etapa 1 — Banco, autenticação, papéis e isolamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres com migrações Drizzle, login por sessão em cookie, papéis (`admin`, `partner_user`, `player`), gestão de parceiros pelo admin, conta player por parceiro e teste automatizado provando que um parceiro não lê nem altera dados de outro.

**Architecture:** Módulos `db`, `auth` e `partners` dentro de `apps/api`. `buildApp` recebe um `db` opcional; com ele registra cookie, hook de sessão e rotas. Rotas de parceiro nunca recebem `partnerId` do cliente — ele vem sempre da sessão. Testes usam PGlite (Postgres embutido) com as mesmas migrações; produção usa `pg` contra o Postgres do Coolify. Migrações rodam no start.

**Tech Stack:** Drizzle ORM + drizzle-kit, `pg`, `@electric-sql/pglite` (testes), `@node-rs/argon2`, `@fastify/cookie`, `zod` 4.

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (seções 4, 5, 10, 13 — Etapa 1)

## Global Constraints

- TypeScript `^6` em todos os pacotes (typescript-eslint não suporta TS 7).
- Senhas com Argon2 (`@node-rs/argon2`); nunca logar senha, hash ou token.
- Sessão: token aleatório de 32 bytes (base64url) no cookie `midora_session` (`httpOnly`, `sameSite=lax`, `path=/`, `secure` = `COOKIE_SECURE === 'true'`); no banco guarda-se somente o SHA-256 do token. Validade: 30 dias (staff), 365 dias (`player`).
- Usuários de papel diferente de `admin` só autenticam se o parceiro estiver `active`.
- Rotas de parceiro derivam `partnerId` exclusivamente de `req.user`; corpos de requisição são `.strict()` (campos extras → 400).
- Respostas de erro JSON: `{ "error": "<codigo>" }` com códigos `invalid_request` (400), `invalid_credentials` (401), `unauthenticated` (401), `forbidden` (403), `not_found` (404), `slug_taken` / `email_taken` (409).
- E-mails normalizados com `trim().toLowerCase()` antes de gravar e de comparar.
- Login do player: `tv@<slug-do-parceiro>`; trocar a senha encerra todas as sessões do player (D3).
- Migrações geradas por drizzle-kit em `apps/api/drizzle/` e versionadas; aplicadas automaticamente no start. Nenhuma migração destrutiva sem autorização do usuário.
- Segredos (`DATABASE_URL`, `ADMIN_PASSWORD`) só no Coolify.
- Branch `feat/etapa-1-dados-auth`; Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; merge na `main` só com aprovação do usuário.
- **Decisões desta etapa:** (a) `SESSION_SECRET` não é necessário — o token é opaco e só seu hash fica no banco, não há assinatura; (b) telas do painel ficam para a Etapa 2 (junto com anunciantes/campanhas); nesta etapa o admin opera pela API; (c) `advertiser_id` em `users` entra na Etapa 2 junto com a tabela `advertisers`.

## Review Focus

1. E-mail inexistente e senha errada devem dar a **mesma** resposta 401 (sem revelar quais e-mails existem) — teste na Task 3.
2. Cookie de sessão expirado ou forjado deve dar 401, nunca 500 — teste na Task 3.
3. Desativar um parceiro deve derrubar imediatamente as sessões dos seus usuários e TVs — teste na Task 4.
4. Corpo com `partnerId` (tentando mirar outro parceiro) deve ser rejeitado com 400, não ignorado nem aplicado — teste na Task 4.
5. `Admin@X.com ` deve logar como `admin@x.com`, e cadastrar `A@x.com` quando `a@x.com` existe deve dar 409 — testes nas Tasks 3 e 4.
6. Banco fora do ar → `/api/health` responde 503 para o Coolify marcar a aplicação como não saudável — teste na Task 3.

---

## Estrutura de arquivos

```
apps/api/
  drizzle.config.ts
  drizzle/                     migrações geradas (SQL + meta)
  src/db/schema.ts             tabelas partners, users, sessions
  src/db/client.ts             createDb(url) → { db, migrate, close }; tipo Db
  src/db/errors.ts             isUniqueViolation(err)
  src/auth/password.ts         hashPassword, verifyPassword, dummyVerify
  src/auth/sessions.ts         createSession, findSessionUser, deleteSession, deleteUserSessions
  src/auth/guard.ts            requireRole(...roles)
  src/auth/plugin.ts           registerAuth(app, { db, cookieSecure }) + rotas /api/auth/*
  src/http/validation.ts       parse(schema, data, reply)
  src/partners/admin-routes.ts /api/admin/partners*
  src/partners/partner-routes.ts /api/partner*
  src/bootstrap.ts             ensureAdmin(db, { email, password })
  src/config.ts                (modificado) databaseUrl, cookieSecure, adminEmail, adminPassword
  src/health.ts                (modificado) checa o banco
  src/app.ts                   (modificado) registra auth e rotas quando há db
  src/server.ts                (modificado) conecta, migra, bootstrap, encerra pool
  test/helpers/db.ts           createTestDb() com PGlite + migrações
  test/helpers/fixtures.ts     createPartner, createUser, login
  test/schema.test.ts
  test/auth.test.ts
  test/partners.test.ts
  test/bootstrap.test.ts
packages/shared/src/index.ts   (modificado) HealthResponse.status 'ok' | 'error'
Dockerfile                     (modificado) copia apps/api/drizzle
docs/DEPLOY.md                 (modificado) banco, variáveis, backup
README.md                      (modificado) DATABASE_URL local
```

---

### Task 1: Schema, migrações e banco de teste

**Files:**
- Create: `apps/api/drizzle.config.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/errors.ts`, `apps/api/test/helpers/db.ts`, `apps/api/test/schema.test.ts`
- Create (gerado): `apps/api/drizzle/0000_init.sql`, `apps/api/drizzle/meta/*`
- Modify: `apps/api/package.json` (script `db:generate`), `apps/api/tsconfig.json` (incluir `drizzle.config.ts`)

**Interfaces:**
- Produces:
  - tabelas `partners`, `users`, `sessions`; `ROLES = ['admin','partner_user','advertiser','player'] as const`; `type Role`
  - `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`
  - `createDb(url: string): { db: Db; migrate(folder: string): Promise<void>; close(): Promise<void> }`
  - `isUniqueViolation(err: unknown): boolean`
  - `createTestDb(): Promise<{ db: Db; close(): Promise<void> }>`

- [ ] **Step 1: Branch e dependências**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-1-dados-auth
pnpm --filter @midora/api add drizzle-orm pg @node-rs/argon2 @fastify/cookie zod
pnpm --filter @midora/api add -D drizzle-kit @electric-sql/pglite @types/pg
```

`apps/api/package.json` — adicionar em `scripts`:
```json
"db:generate": "drizzle-kit generate"
```

`apps/api/tsconfig.json` — `include` passa a ser `["src", "test", "tsup.config.ts", "drizzle.config.ts"]`.

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

- [ ] **Step 2: Schema**

`apps/api/src/db/schema.ts`:
```ts
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    weightLow: integer('weight_low').notNull().default(1),
    weightMedium: integer('weight_medium').notNull().default(2),
    weightHigh: integer('weight_high').notNull().default(3),
    defaultImageSeconds: integer('default_image_seconds').notNull().default(10),
    showInstitutional: boolean('show_institutional').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check('partners_status_check', sql`${t.status} in ('active', 'inactive')`),
    check(
      'partners_weights_check',
      sql`${t.weightLow} > 0 and ${t.weightMedium} > 0 and ${t.weightHigh} > 0`,
    ),
    check('partners_image_seconds_check', sql`${t.defaultImageSeconds} between 1 and 3600`),
  ],
);

export const ROLES = ['admin', 'partner_user', 'advertiser', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('admin', 'partner_user', 'advertiser', 'player')`),
    // admin has no partner; every other role belongs to exactly one partner.
    check('users_partner_scope_check', sql`(${t.role} = 'admin') = (${t.partnerId} is null)`),
    uniqueIndex('users_one_player_per_partner').on(t.partnerId).where(sql`${t.role} = 'player'`),
    index('users_partner_idx').on(t.partnerId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(token) hex
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);
```

- [ ] **Step 3: Gerar a migração**

Run: `pnpm --filter @midora/api db:generate --name init`
Expected: cria `apps/api/drizzle/0000_init.sql` com `CREATE TABLE "partners"`, `"users"`, `"sessions"`, as constraints `CHECK` e o índice único parcial `users_one_player_per_partner ... WHERE`.

- [ ] **Step 4: Cliente, erros e helper de teste**

`apps/api/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 10 });
  const nodeDb = drizzle(pool, { schema });
  return {
    db: nodeDb as unknown as Db,
    migrate: (migrationsFolder: string) => migrate(nodeDb, { migrationsFolder }),
    close: () => pool.end(),
  };
}
```

`apps/api/src/db/errors.ts`:
```ts
// Postgres unique_violation, possibly wrapped by drizzle in `cause`.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
```

`apps/api/test/helpers/db.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '../../src/db/client';
import * as schema from '../../src/db/schema';

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  return { db: db as unknown as Db, close: () => client.close() };
}
```

- [ ] **Step 5: Teste das constraints (escrever antes de considerar o schema pronto)**

`apps/api/test/schema.test.ts`:
```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { isUniqueViolation } from '../src/db/errors';
import { partners, users } from '../src/db/schema';
import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
let partnerId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [p] = await db.insert(partners).values({ name: 'A', slug: 'a' }).returning();
  partnerId = p!.id;
});
afterAll(() => close());

it('applies partner defaults', async () => {
  const [p] = await db.insert(partners).values({ name: 'B', slug: 'b' }).returning();
  expect(p).toMatchObject({
    status: 'active', weightLow: 1, weightMedium: 2, weightHigh: 3,
    defaultImageSeconds: 10, showInstitutional: false,
  });
});

it('rejects duplicate slug as unique violation', async () => {
  const err = await db.insert(partners).values({ name: 'A2', slug: 'a' }).catch((e) => e);
  expect(isUniqueViolation(err)).toBe(true);
});

it('rejects admin with a partner and partner_user without one', async () => {
  await expect(
    db.insert(users).values({ email: 'x@x.com', passwordHash: 'h', role: 'admin', partnerId }),
  ).rejects.toThrow();
  await expect(
    db.insert(users).values({ email: 'y@x.com', passwordHash: 'h', role: 'partner_user' }),
  ).rejects.toThrow();
});

it('allows only one player per partner', async () => {
  await db.insert(users).values({ email: 'tv@a', passwordHash: 'h', role: 'player', partnerId });
  const err = await db
    .insert(users)
    .values({ email: 'tv2@a', passwordHash: 'h', role: 'player', partnerId })
    .catch((e) => e);
  expect(isUniqueViolation(err)).toBe(true);
});

it('rejects non-positive weights', async () => {
  await expect(
    db.insert(partners).values({ name: 'C', slug: 'c', weightHigh: 0 }),
  ).rejects.toThrow();
});
```

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @midora/api test -- schema && pnpm --filter @midora/api typecheck`
Expected: 5 PASS; typecheck limpo. (Se algum teste passar sem a constraint correspondente na migração, a migração está errada — corrigir o schema e regenerar.)

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add database schema, migrations and test database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Senhas e sessões

**Files:**
- Create: `apps/api/src/auth/password.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/test/helpers/fixtures.ts`, `apps/api/test/sessions.test.ts`

**Interfaces:**
- Consumes: `Db`, `partners`, `users`, `sessions`, `Role`, `createTestDb` (Task 1).
- Produces:
  - `hashPassword(pw: string): Promise<string>`; `verifyPassword(hash: string, pw: string): Promise<boolean>`; `dummyVerify(pw: string): Promise<false>`
  - `interface SessionUser { id: string; email: string; role: Role; partnerId: string | null }`
  - `SESSION_TTL_MS = { staff: number; player: number }`
  - `createSession(db, user: { id: string; role: Role }): Promise<{ token: string; expiresAt: Date }>`
  - `findSessionUser(db, token: string): Promise<SessionUser | null>`
  - `deleteSession(db, token: string): Promise<void>`; `deleteUserSessions(db, userId: string): Promise<void>`
  - fixtures: `createPartner(db, slug: string, status?: 'active' | 'inactive')`, `createUser(db, { email, password, role, partnerId? })` → linhas inseridas

- [ ] **Step 1: Fixtures e teste que falha**

`apps/api/test/helpers/fixtures.ts`:
```ts
import { hashPassword } from '../../src/auth/password';
import type { Db } from '../../src/db/client';
import { partners, users, type Role } from '../../src/db/schema';

export async function createPartner(db: Db, slug: string, status: 'active' | 'inactive' = 'active') {
  const [p] = await db.insert(partners).values({ name: `Parceiro ${slug}`, slug, status }).returning();
  return p!;
}

export async function createUser(
  db: Db,
  u: { email: string; password: string; role: Role; partnerId?: string },
) {
  const [row] = await db
    .insert(users)
    .values({
      email: u.email,
      passwordHash: await hashPassword(u.password),
      role: u.role,
      partnerId: u.partnerId ?? null,
    })
    .returning();
  return row!;
}
```

`apps/api/test/sessions.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, verifyPassword } from '../src/auth/password';
import {
  SESSION_TTL_MS, createSession, deleteSession, deleteUserSessions, findSessionUser,
} from '../src/auth/sessions';
import type { Db } from '../src/db/client';
import { partners, sessions } from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { createPartner, createUser } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

describe('password', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse');
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword(h, 'correct horse')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('dummyVerify always resolves false', async () => {
    expect(await dummyVerify('anything')).toBe(false);
  });
});

describe('sessions', () => {
  it('stores only the token hash and resolves the user', async () => {
    const p = await createPartner(db, 's1');
    const u = await createUser(db, { email: 'u@s1.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const { token, expiresAt } = await createSession(db, u);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(token);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS.staff - 60_000);
    expect(await findSessionUser(db, token)).toEqual({
      id: u.id, email: 'u@s1.com', role: 'partner_user', partnerId: p.id,
    });
  });

  it('gives players a long session', async () => {
    const p = await createPartner(db, 's2');
    const tv = await createUser(db, { email: 'tv@s2', password: 'password1', role: 'player', partnerId: p.id });
    const { expiresAt } = await createSession(db, tv);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS.player - 60_000);
  });

  it('returns null for unknown, expired and deleted sessions', async () => {
    const p = await createPartner(db, 's3');
    const u = await createUser(db, { email: 'u@s3.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    expect(await findSessionUser(db, 'forged-token')).toBeNull();

    const { token } = await createSession(db, u);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, u.id));
    expect(await findSessionUser(db, token)).toBeNull();

    const s2 = await createSession(db, u);
    await deleteSession(db, s2.token);
    expect(await findSessionUser(db, s2.token)).toBeNull();
  });

  it('returns null when the partner is inactive, but admins have no partner', async () => {
    const p = await createPartner(db, 's4');
    const u = await createUser(db, { email: 'u@s4.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const { token } = await createSession(db, u);
    await db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, p.id));
    expect(await findSessionUser(db, token)).toBeNull();

    const admin = await createUser(db, { email: 'adm@s4.com', password: 'password1', role: 'admin' });
    const a = await createSession(db, admin);
    expect((await findSessionUser(db, a.token))?.role).toBe('admin');
  });

  it('deleteUserSessions removes all sessions of one user only', async () => {
    const p = await createPartner(db, 's5');
    const u1 = await createUser(db, { email: 'a@s5.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const u2 = await createUser(db, { email: 'b@s5.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const t1 = await createSession(db, u1);
    const t1b = await createSession(db, u1);
    const t2 = await createSession(db, u2);
    await deleteUserSessions(db, u1.id);
    expect(await findSessionUser(db, t1.token)).toBeNull();
    expect(await findSessionUser(db, t1b.token)).toBeNull();
    expect(await findSessionUser(db, t2.token)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test -- sessions`
Expected: FAIL — `../src/auth/password` e `../src/auth/sessions` não existem.

- [ ] **Step 3: Implementação**

`apps/api/src/auth/password.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Spends the same time as a real verification so unknown e-mails are not detectable by timing.
let dummyHash: Promise<string> | undefined;
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hash('midora-dummy-password');
  await verifyPassword(await dummyHash, password);
  return false;
}
```

`apps/api/src/auth/sessions.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { partners, sessions, users, type Role } from '../db/schema';

const DAY_MS = 86_400_000;
export const SESSION_TTL_MS = { staff: 30 * DAY_MS, player: 365 * DAY_MS };

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  partnerId: string | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, user: { id: string; role: Role }) {
  const token = randomBytes(32).toString('base64url');
  const ttl = user.role === 'player' ? SESSION_TTL_MS.player : SESSION_TTL_MS.staff;
  const expiresAt = new Date(Date.now() + ttl);
  await db.insert(sessions).values({ id: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt };
}

export async function findSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      partnerId: users.partnerId,
      partnerStatus: partners.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (row.role !== 'admin' && row.partnerStatus !== 'active') return null;
  return { id: row.id, email: row.email, role: row.role, partnerId: row.partnerId };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm --filter @midora/api typecheck`
Expected: todos PASS (8 novos); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add password hashing and hashed-token sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Login, logout, me e health com banco

**Files:**
- Create: `apps/api/src/http/validation.ts`, `apps/api/src/auth/guard.ts`, `apps/api/src/auth/plugin.ts`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/health.ts`, `packages/shared/src/index.ts`, `apps/api/test/fixtures` (adicionar `login`)

**Interfaces:**
- Consumes: Task 1 e 2.
- Produces:
  - `AppOptions` ganha `db?: Db` e `cookieSecure?: boolean`
  - `SESSION_COOKIE = 'midora_session'`; `registerAuth(app, { db, cookieSecure }): Promise<void>`; `req.user: SessionUser | null`
  - `requireRole(...roles: Role[])` → preHandler (401 `unauthenticated`, 403 `forbidden`)
  - `parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | undefined` (400 `invalid_request`)
  - HTTP: `POST /api/auth/login` `{email,password}` → 200 `{ user }` + cookie | 401 `invalid_credentials`; `POST /api/auth/logout` → 204; `GET /api/auth/me` → 200 `{ user }` | 401
  - `HealthResponse = { status: 'ok' | 'error'; version: string }`; `/api/health` → 503 se o banco falhar
  - fixture `login(app, email, password): Promise<string>` → valor do header `cookie`

- [ ] **Step 1: Teste que falha**

Adicionar a `apps/api/test/helpers/fixtures.ts`:
```ts
import type { FastifyInstance } from 'fastify';

export async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'midora_session');
  return `midora_session=${c!.value}`;
}
```

`apps/api/test/auth.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Db } from '../src/db/client';
import { sessions } from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { createPartner, createUser, login } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let partnerUserId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const p = await createPartner(db, 'ironberg');
  const u = await createUser(db, { email: 'gerente@ironberg.com', password: 'senha-forte-1', role: 'partner_user', partnerId: p.id });
  partnerUserId = u.id;
  await createUser(db, { email: 'admin@midora.com', password: 'senha-admin-1', role: 'admin' });
  app = await buildApp({ version: 't', db });
});
afterAll(async () => {
  await app.close();
  await close();
});

const post = (url: string, payload?: unknown, cookie?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });
const getMe = (cookie?: string) =>
  app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

describe('login', () => {
  it('logs in and sets an httpOnly session cookie', async () => {
    const res = await post('/api/auth/login', { email: 'gerente@ironberg.com', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'gerente@ironberg.com', role: 'partner_user' });
    expect(res.json().user.passwordHash).toBeUndefined();
    const c = res.cookies.find((x) => x.name === 'midora_session');
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
    expect(c?.path).toBe('/');
  });

  it('normalizes e-mail case and whitespace', async () => {
    const res = await post('/api/auth/login', { email: '  Gerente@IronBerg.com ', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(200);
  });

  it('answers unknown e-mail and wrong password identically', async () => {
    const a = await post('/api/auth/login', { email: 'nao@existe.com', password: 'senha-forte-1' });
    const b = await post('/api/auth/login', { email: 'gerente@ironberg.com', password: 'errada' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual({ error: 'invalid_credentials' });
    expect(b.json()).toEqual(a.json());
  });

  it('rejects malformed bodies with 400', async () => {
    expect((await post('/api/auth/login', { email: 'x' })).statusCode).toBe(400);
    expect((await post('/api/auth/login', { email: 'a@b.com', password: 'p', extra: 1 })).statusCode).toBe(400);
  });
});

describe('me and logout', () => {
  it('returns the current user and 401 without a session', async () => {
    const cookie = await login(app, 'admin@midora.com', 'senha-admin-1');
    const res = await getMe(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'admin@midora.com', role: 'admin', partnerId: null });
    expect((await getMe()).json()).toEqual({ error: 'unauthenticated' });
    expect((await getMe()).statusCode).toBe(401);
  });

  it('returns 401 (not 500) for forged and expired cookies', async () => {
    expect((await getMe('midora_session=forjado')).statusCode).toBe(401);
    const cookie = await login(app, 'gerente@ironberg.com', 'senha-forte-1');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, partnerUserId));
    expect((await getMe(cookie)).statusCode).toBe(401);
  });

  it('logout invalidates the session and clears the cookie', async () => {
    const cookie = await login(app, 'admin@midora.com', 'senha-admin-1');
    const res = await post('/api/auth/logout', undefined, cookie);
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((x) => x.name === 'midora_session')?.value).toBe('');
    expect((await getMe(cookie)).statusCode).toBe(401);
  });
});

describe('health with database', () => {
  it('is ok when the database answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 't' });
  });

  it('is 503 when the database is down', async () => {
    const downDb = { execute: async () => { throw new Error('down'); } } as unknown as Db;
    const down = await buildApp({ version: 't', db: downDb });
    const res = await down.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', version: 't' });
    await down.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test -- auth`
Expected: FAIL — rotas `/api/auth/*` retornam 404; health com banco caído retorna 200.

- [ ] **Step 3: Implementação**

`packages/shared/src/index.ts`:
```ts
export interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
}
```

`apps/api/src/http/validation.ts`:
```ts
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

export function parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({
      error: 'invalid_request',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return undefined;
  }
  return result.data;
}
```

`apps/api/src/auth/guard.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '../db/schema';

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden' });
  };
}
```

`apps/api/src/auth/plugin.ts`:
```ts
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { ROLES, partners, users } from '../db/schema';
import { parse } from '../http/validation';
import { requireRole } from './guard';
import { dummyVerify, verifyPassword } from './password';
import { createSession, deleteSession, findSessionUser, type SessionUser } from './sessions';

export const SESSION_COOKIE = 'midora_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export async function registerAuth(
  app: FastifyInstance,
  { db, cookieSecure }: { db: Db; cookieSecure: boolean },
): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    if (!req.url.startsWith('/api/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = await findSessionUser(db, token);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(LoginBody, req.body, reply);
    if (!body) return reply;
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        partnerId: users.partnerId,
        passwordHash: users.passwordHash,
        partnerStatus: partners.status,
      })
      .from(users)
      .leftJoin(partners, eq(partners.id, users.partnerId))
      .where(eq(users.email, body.email))
      .limit(1);
    const valid = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await dummyVerify(body.password);
    if (!user || !valid || (user.role !== 'admin' && user.partnerStatus !== 'active')) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const { token, expiresAt } = await createSession(db, user);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure, expires: expiresAt,
    });
    const { id, email, role, partnerId } = user;
    return { user: { id, email, role, partnerId } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireRole(...ROLES) }, async (req) => ({ user: req.user }));
}
```

`apps/api/src/health.ts`:
```ts
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@midora/shared';
import type { Db } from './db/client';

export const healthRoutes: FastifyPluginAsync<{ version: string; db?: Db }> = async (
  app,
  { version, db },
) => {
  app.get('/api/health', async (_req, reply): Promise<HealthResponse> => {
    if (db) {
      try {
        await db.execute(sql`select 1`);
      } catch (err) {
        app.log.error({ err }, 'database health check failed');
        reply.code(503);
        return { status: 'error', version };
      }
    }
    return { status: 'ok', version };
  });
};
```

`apps/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAuth } from './auth/plugin';
import type { Db } from './db/client';
import { healthRoutes } from './health';
import { registerStatic } from './static';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  webDir?: string;
  playerDir?: string;
  db?: Db;
  cookieSecure?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, { version: opts.version, db: opts.db });
  if (opts.db) {
    await registerAuth(app, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
  }
  await registerStatic(app, { webDir: opts.webDir, playerDir: opts.playerDir });
  return app;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: todos PASS (auth: 9 novos; anteriores seguem verdes); typecheck e lint limpos.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): add login, logout, me and database-aware health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Parceiros, usuários, conta player e isolamento

**Files:**
- Create: `apps/api/src/partners/admin-routes.ts`, `apps/api/src/partners/partner-routes.ts`, `apps/api/test/partners.test.ts`
- Modify: `apps/api/src/app.ts` (registrar as rotas quando há `db`)

**Interfaces:**
- Consumes: `Db`, `partners`, `users`, `isUniqueViolation`, `hashPassword`, `deleteUserSessions`, `requireRole`, `parse`, `registerAuth`, fixtures (`createPartner`, `createUser`, `login`).
- Produces HTTP:
  - Admin (`requireRole('admin')`): `GET /api/admin/partners` → `{ partners }`; `POST /api/admin/partners` `{ name, slug, showInstitutional? }` → 201 `{ partner }` | 409 `slug_taken`; `PATCH /api/admin/partners/:id` `{ name?, status?, showInstitutional?, weightLow?, weightMedium?, weightHigh?, defaultImageSeconds? }` → `{ partner }` | 404; `POST /api/admin/partners/:id/users` `{ email, password }` → 201 `{ user }` (papel `partner_user`) | 404 | 409 `email_taken`
  - Parceiro (`requireRole('partner_user')`): `GET /api/partner` → `{ partner }`; `GET /api/partner/users` → `{ users }` (`id`, `email`, `role`); `PUT /api/partner/player-account` `{ password }` → `{ login: 'tv@<slug>' }`
  - `adminPartnerRoutes`, `partnerRoutes`: `FastifyPluginAsync<{ db: Db }>`

- [ ] **Step 1: Teste que falha**

`apps/api/test/partners.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Db } from '../src/db/client';
import { createTestDb } from './helpers/db';
import { createPartner, createUser, login } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let admin: string;
let gerenteA: string;
let gerenteB: string;
let partnerA: { id: string; slug: string };
let partnerB: { id: string; slug: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  partnerA = await createPartner(db, 'parceiro-a');
  partnerB = await createPartner(db, 'parceiro-b');
  await createUser(db, { email: 'admin@midora.com', password: 'senha-admin-1', role: 'admin' });
  await createUser(db, { email: 'g@a.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerA.id });
  await createUser(db, { email: 'g@b.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerB.id });
  app = await buildApp({ version: 't', db });
  admin = await login(app, 'admin@midora.com', 'senha-admin-1');
  gerenteA = await login(app, 'g@a.com', 'senha-forte-1');
  gerenteB = await login(app, 'g@b.com', 'senha-forte-1');
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

describe('admin partner management', () => {
  it('creates, lists and updates partners', async () => {
    const created = await req('POST', '/api/admin/partners', admin, { name: 'Ironberg', slug: 'ironberg' });
    expect(created.statusCode).toBe(201);
    const id = created.json().partner.id;
    expect(created.json().partner).toMatchObject({ slug: 'ironberg', status: 'active', showInstitutional: false });

    const list = await req('GET', '/api/admin/partners', admin);
    expect(list.json().partners.map((p: { slug: string }) => p.slug)).toContain('ironberg');

    const upd = await req('PATCH', `/api/admin/partners/${id}`, admin, { showInstitutional: true, weightHigh: 5 });
    expect(upd.json().partner).toMatchObject({ showInstitutional: true, weightHigh: 5 });
  });

  it('rejects duplicate and invalid slugs', async () => {
    expect((await req('POST', '/api/admin/partners', admin, { name: 'X', slug: 'parceiro-a' })).json())
      .toEqual({ error: 'slug_taken' });
    expect((await req('POST', '/api/admin/partners', admin, { name: 'X', slug: 'Com Espaço' })).statusCode).toBe(400);
  });

  it('returns 404 for unknown partner ids', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await req('PATCH', `/api/admin/partners/${id}`, admin, { name: 'Y' })).statusCode).toBe(404);
    expect((await req('POST', `/api/admin/partners/${id}/users`, admin, { email: 'n@n.com', password: 'senha-forte-1' })).statusCode).toBe(404);
  });

  it('creates partner users and rejects duplicate e-mails case-insensitively', async () => {
    const res = await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'Novo@A.com', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'novo@a.com', role: 'partner_user', partnerId: partnerA.id });
    const dup = await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'NOVO@a.com', password: 'senha-forte-1' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'email_taken' });
  });

  it('rejects short passwords', async () => {
    expect((await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'c@a.com', password: '123' })).statusCode).toBe(400);
  });
});

describe('isolation between partners', () => {
  it('each partner user sees only its own partner and users', async () => {
    expect((await req('GET', '/api/partner', gerenteA)).json().partner.id).toBe(partnerA.id);
    expect((await req('GET', '/api/partner', gerenteB)).json().partner.id).toBe(partnerB.id);
    const usersA = (await req('GET', '/api/partner/users', gerenteA)).json().users as { email: string }[];
    expect(usersA.map((u) => u.email)).not.toContain('g@b.com');
    expect(usersA.map((u) => u.email)).toContain('g@a.com');
  });

  it('partner users cannot use admin routes', async () => {
    expect((await req('GET', '/api/admin/partners', gerenteA)).statusCode).toBe(403);
    expect((await req('PATCH', `/api/admin/partners/${partnerB.id}`, gerenteA, { name: 'hack' })).statusCode).toBe(403);
    expect((await req('POST', `/api/admin/partners/${partnerB.id}/users`, gerenteA, { email: 'x@b.com', password: 'senha-forte-1' })).statusCode).toBe(403);
  });

  it('rejects attempts to target another partner through the body', async () => {
    const res = await req('PUT', '/api/partner/player-account', gerenteA, { password: 'senha-tv-123', partnerId: partnerB.id });
    expect(res.statusCode).toBe(400);
  });

  it('requires a session for partner routes', async () => {
    expect((await req('GET', '/api/partner')).statusCode).toBe(401);
  });
});

describe('player account', () => {
  it('creates the TV login, lets it sign in, and is forbidden on partner routes', async () => {
    const res = await req('PUT', '/api/partner/player-account', gerenteA, { password: 'senha-tv-123' });
    expect(res.json()).toEqual({ login: 'tv@parceiro-a' });
    const tv = await login(app, 'tv@parceiro-a', 'senha-tv-123');
    const me = await req('GET', '/api/auth/me', tv);
    expect(me.json().user).toMatchObject({ role: 'player', partnerId: partnerA.id });
    expect((await req('GET', '/api/partner', tv)).statusCode).toBe(403);
    expect((await req('GET', '/api/admin/partners', tv)).statusCode).toBe(403);
  });

  it('changing the password signs out existing TVs of that partner only', async () => {
    await req('PUT', '/api/partner/player-account', gerenteB, { password: 'senha-tv-b-1' });
    const tvA = await login(app, 'tv@parceiro-a', 'senha-tv-123');
    const tvB = await login(app, 'tv@parceiro-b', 'senha-tv-b-1');
    await req('PUT', '/api/partner/player-account', gerenteA, { password: 'nova-senha-tv-1' });
    expect((await req('GET', '/api/auth/me', tvA)).statusCode).toBe(401);
    expect((await req('GET', '/api/auth/me', tvB)).statusCode).toBe(200);
    await login(app, 'tv@parceiro-a', 'nova-senha-tv-1');
  });
});

describe('deactivating a partner', () => {
  it('immediately ends its sessions and blocks new logins', async () => {
    const p = await createPartner(db, 'parceiro-c');
    await createUser(db, { email: 'g@c.com', password: 'senha-forte-1', role: 'partner_user', partnerId: p.id });
    const gerenteC = await login(app, 'g@c.com', 'senha-forte-1');
    await req('PATCH', `/api/admin/partners/${p.id}`, admin, { status: 'inactive' });
    expect((await req('GET', '/api/partner', gerenteC)).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'g@c.com', password: 'senha-forte-1' } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test -- partners`
Expected: FAIL — rotas `/api/admin/*` e `/api/partner*` inexistentes (404).

- [ ] **Step 3: Implementação**

`apps/api/src/partners/admin-routes.ts`:
```ts
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { hashPassword } from '../auth/password';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { partners, users } from '../db/schema';
import { parse } from '../http/validation';

const Slug = z.string().max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Weight = z.number().int().min(1).max(100);

const CreatePartner = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: Slug,
    showInstitutional: z.boolean().optional(),
  })
  .strict();

const UpdatePartner = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    showInstitutional: z.boolean().optional(),
    weightLow: Weight.optional(),
    weightMedium: Weight.optional(),
    weightHigh: Weight.optional(),
    defaultImageSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .strict();

const CreateUser = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8).max(200),
  })
  .strict();

const IdParams = z.object({ id: z.uuid() });

export const adminPartnerRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/api/admin/partners', async () => ({
    partners: await db.select().from(partners).orderBy(asc(partners.name)),
  }));

  app.post('/api/admin/partners', async (req, reply) => {
    const body = parse(CreatePartner, req.body, reply);
    if (!body) return reply;
    try {
      const [partner] = await db.insert(partners).values(body).returning();
      return reply.code(201).send({ partner });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'slug_taken' });
      throw err;
    }
  });

  app.patch('/api/admin/partners/:id', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePartner, req.body, reply);
    if (!body) return reply;
    const [partner] = await db
      .update(partners)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(partners.id, params.id))
      .returning();
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    return { partner };
  });

  app.post('/api/admin/partners/:id/users', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(CreateUser, req.body, reply);
    if (!body) return reply;
    const [partner] = await db.select({ id: partners.id }).from(partners).where(eq(partners.id, params.id));
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    try {
      const [user] = await db
        .insert(users)
        .values({
          email: body.email,
          passwordHash: await hashPassword(body.password),
          role: 'partner_user',
          partnerId: partner.id,
        })
        .returning({ id: users.id, email: users.email, role: users.role, partnerId: users.partnerId });
      return reply.code(201).send({ user });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'email_taken' });
      throw err;
    }
  });
};
```

`apps/api/src/partners/partner-routes.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { hashPassword } from '../auth/password';
import { deleteUserSessions } from '../auth/sessions';
import type { Db } from '../db/client';
import { partners, users } from '../db/schema';
import { parse } from '../http/validation';

const PlayerAccount = z.object({ password: z.string().min(8).max(200) }).strict();

// partnerId always comes from the session, never from the request.
export const partnerRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('partner_user'));

  app.get('/api/partner', async (req) => {
    const [partner] = await db.select().from(partners).where(eq(partners.id, req.user!.partnerId!));
    return { partner };
  });

  app.get('/api/partner/users', async (req) => ({
    users: await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.partnerId, req.user!.partnerId!))
      .orderBy(asc(users.email)),
  }));

  app.put('/api/partner/player-account', async (req, reply) => {
    const body = parse(PlayerAccount, req.body, reply);
    if (!body) return reply;
    const partnerId = req.user!.partnerId!;
    const [partner] = await db.select({ slug: partners.slug }).from(partners).where(eq(partners.id, partnerId));
    const loginName = `tv@${partner!.slug}`;
    const passwordHash = await hashPassword(body.password);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.partnerId, partnerId), eq(users.role, 'player')));
    if (existing) {
      await db.update(users).set({ passwordHash, email: loginName, updatedAt: new Date() }).where(eq(users.id, existing.id));
      await deleteUserSessions(db, existing.id);
    } else {
      await db.insert(users).values({ email: loginName, passwordHash, role: 'player', partnerId });
    }
    return { login: loginName };
  });
};
```

`apps/api/src/app.ts` — dentro do `if (opts.db)`, após `registerAuth`:
```ts
    await app.register(adminPartnerRoutes, { db: opts.db });
    await app.register(partnerRoutes, { db: opts.db });
```
com os imports:
```ts
import { adminPartnerRoutes } from './partners/admin-routes';
import { partnerRoutes } from './partners/partner-routes';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: todos PASS (partners: 12 novos); typecheck e lint limpos.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add partner management, player account and partner isolation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bootstrap do admin, servidor com banco e imagem

**Files:**
- Create: `apps/api/src/bootstrap.ts`, `apps/api/test/bootstrap.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/test/config.test.ts`, `apps/api/src/server.ts`, `Dockerfile`, `README.md`

**Interfaces:**
- Consumes: `createDb`, `hashPassword`, `users`, `buildApp`.
- Produces:
  - `Config` ganha `databaseUrl?: string; cookieSecure: boolean; adminEmail?: string; adminPassword?: string`
  - `ensureAdmin(db, { email, password }): Promise<'created' | 'exists'>` (senha < 12 caracteres → erro)
  - `server.ts`: exige `DATABASE_URL`, aplica migrações de `../drizzle` relativo ao arquivo, roda `ensureAdmin` se `ADMIN_EMAIL` e `ADMIN_PASSWORD` existirem, fecha o pool no shutdown
  - imagem com `/app/drizzle`

- [ ] **Step 1: Testes que falham**

`apps/api/test/config.test.ts` — substituir os dois primeiros testes por:
```ts
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      webDir: undefined,
      playerDir: undefined,
      version: 'dev',
      logLevel: 'info',
      databaseUrl: undefined,
      cookieSecure: false,
      adminEmail: undefined,
      adminPassword: undefined,
    });
  });

  it('reads env values', () => {
    const c = loadConfig({
      PORT: '8080', HOST: '127.0.0.1', WEB_DIR: '/w', PLAYER_DIR: '/p',
      APP_VERSION: '1.2.3', LOG_LEVEL: 'debug', DATABASE_URL: 'postgres://x',
      COOKIE_SECURE: 'true', ADMIN_EMAIL: 'a@b.com', ADMIN_PASSWORD: 'secret-pass-123',
    });
    expect(c).toEqual({
      port: 8080, host: '127.0.0.1', webDir: '/w', playerDir: '/p',
      version: '1.2.3', logLevel: 'debug', databaseUrl: 'postgres://x',
      cookieSecure: true, adminEmail: 'a@b.com', adminPassword: 'secret-pass-123',
    });
  });
```

`apps/api/test/bootstrap.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password';
import { ensureAdmin } from '../src/bootstrap';
import type { Db } from '../src/db/client';
import { users } from '../src/db/schema';
import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

it('creates the admin once and never overwrites its password', async () => {
  expect(await ensureAdmin(db, { email: ' Admin@Midora.com ', password: 'primeira-senha-1' })).toBe('created');
  expect(await ensureAdmin(db, { email: 'admin@midora.com', password: 'outra-senha-123' })).toBe('exists');
  const [u] = await db.select().from(users).where(eq(users.email, 'admin@midora.com'));
  expect(u!.role).toBe('admin');
  expect(await verifyPassword(u!.passwordHash, 'primeira-senha-1')).toBe(true);
});

it('refuses passwords shorter than 12 characters', async () => {
  await expect(ensureAdmin(db, { email: 'x@midora.com', password: 'curta' })).rejects.toThrow(
    'ADMIN_PASSWORD must have at least 12 characters',
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test -- config bootstrap`
Expected: FAIL — campos novos ausentes em `loadConfig`; `../src/bootstrap` inexistente.

- [ ] **Step 3: Implementação**

`apps/api/src/config.ts`:
```ts
export interface Config {
  port: number;
  host: string;
  webDir?: string;
  playerDir?: string;
  version: string;
  logLevel: string;
  databaseUrl?: string;
  cookieSecure: boolean;
  adminEmail?: string;
  adminPassword?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    webDir: env.WEB_DIR || undefined,
    playerDir: env.PLAYER_DIR || undefined,
    version: env.APP_VERSION ?? env.SOURCE_COMMIT ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: env.DATABASE_URL || undefined,
    cookieSecure: env.COOKIE_SECURE === 'true',
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
  };
}
```

`apps/api/src/bootstrap.ts`:
```ts
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth/password';
import type { Db } from './db/client';
import { users } from './db/schema';

export async function ensureAdmin(
  db: Db,
  { email, password }: { email: string; password: string },
): Promise<'created' | 'exists'> {
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters');
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized));
  if (existing) return 'exists';
  await db.insert(users).values({ email: normalized, passwordHash: await hashPassword(password), role: 'admin' });
  return 'created';
}
```

`apps/api/src/server.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ensureAdmin } from './bootstrap';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { loggerOptions } from './logger';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');

const database = createDb(config.databaseUrl);
await database.migrate(fileURLToPath(new URL('../drizzle', import.meta.url)));

const app = await buildApp({
  version: config.version,
  logger: loggerOptions(config.logLevel),
  webDir: config.webDir,
  playerDir: config.playerDir,
  db: database.db,
  cookieSecure: config.cookieSecure,
});

if (config.adminEmail && config.adminPassword) {
  const result = await ensureAdmin(database.db, { email: config.adminEmail, password: config.adminPassword });
  app.log.info({ result }, 'admin bootstrap');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
```

`Dockerfile` — no estágio final, após `COPY --from=build /app/apps/api/dist ./dist`:
```dockerfile
COPY --from=build /app/apps/api/drizzle ./drizzle
```

`.github/workflows/ci.yml` — o smoke test do job `docker` precisa de banco. Substituir o step `Smoke test` por:
```yaml
      - name: Smoke test
        run: |
          docker network create midora-ci
          docker run -d --name db --network midora-ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=midora postgres:16-alpine
          for i in $(seq 1 30); do docker exec db pg_isready -U postgres && break; sleep 1; done
          docker run -d --name midora --network midora-ci -p 3000:3000 \
            -e DATABASE_URL=postgres://postgres:ci@db:5432/midora midora:ci
          for i in $(seq 1 30); do
            curl -sf http://127.0.0.1:3000/api/health && break
            sleep 1
          done
          curl -sf http://127.0.0.1:3000/api/health | grep '"status":"ok"'
          curl -sf http://127.0.0.1:3000/player/ | grep 'Midora Player'
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/nao-existe)" = 404
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/auth/me)" = 401
          docker logs midora | grep -q 'Server listening'
```

`README.md` — substituir a seção "Desenvolvimento" por:
````markdown
## Desenvolvimento

Requisitos: Node 24+, pnpm 10. Os testes usam PGlite (Postgres embutido) e não precisam de banco.

```bash
pnpm install
pnpm test
```

Para rodar a API localmente é preciso um Postgres (ex.: `brew services start postgresql@16` e `createdb midora`):

```bash
DATABASE_URL=postgres://localhost/midora ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD=<12+ caracteres> pnpm dev:api
pnpm dev:web      # painel, com proxy de /api para a API
pnpm dev:player   # player, com proxy de /api para a API
```

Migrações: alterar `apps/api/src/db/schema.ts` e rodar `pnpm --filter @midora/api db:generate`. Elas são aplicadas no start da API.

Verificações: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
````

- [ ] **Step 4: Rodar tudo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 5: Smoke local sem banco**

```bash
PORT=3999 node apps/api/dist/server.js; echo "exit=$?"
```
Expected: mensagem `DATABASE_URL is required` e `exit=1`.

- [ ] **Step 6: Commit, push e CI**

```bash
git add apps/api Dockerfile .github README.md
git commit -m "feat(api): connect to Postgres, run migrations on start and bootstrap admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-1-dados-auth
```
Verificar o run da branch em `https://api.github.com/repos/deimac/midora/actions/runs?branch=feat/etapa-1-dados-auth&per_page=1`.
Expected: `conclusion: success` (jobs `check` e `docker`, este com Postgres real).

---

### Task 6: Banco no Coolify, deploy e backup

**Files:**
- Modify: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: imagem da Task 5.
- Produces: Postgres `midora-db` no projeto `midora`; app com `DATABASE_URL`, `COOKIE_SECURE=false`, `ADMIN_EMAIL`; backup diário.

**Antes do merge** (o deploy da `main` falharia sem `DATABASE_URL`), enviar ao usuário:

- [ ] **Step 1: Passo a passo do banco (usuário)**

1. Coolify → projeto `midora` → `production` → **+ New** → **Database** → **PostgreSQL** → versão **16** → nome `midora-db`.
2. **Não** marcar *Make it publicly available*.
3. **Resource Limits** → Maximum Memory Limit `512m`.
4. **Start**.
5. Na página do banco, copiar **Postgres URL (internal)**.
6. Aplicação `midora` → **Environment Variables** → adicionar:
   - `DATABASE_URL` = URL interna copiada
   - `COOKIE_SECURE` = `false` (até termos HTTPS)
   - `ADMIN_EMAIL` = e-mail do admin
   - `ADMIN_PASSWORD` = senha do admin (12+ caracteres)
   - Salvar **sem** clicar em Redeploy.
7. Banco `midora-db` → **Backups** → **+ Add** → frequência `0 6 * * *` (03:00 de Brasília), retenção 7 → Save.

- [ ] **Step 2: Verificar o banco pelo MCP**

`search_resources` com `midora-db` → status `running`; `list_env_keys` da aplicação → contém `DATABASE_URL`, `COOKIE_SECURE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (somente nomes).

- [ ] **Step 3: Merge (com aprovação do usuário) e deploy**

```bash
git checkout main
git merge --ff-only feat/etapa-1-dados-auth
git push origin main
```
Acompanhar `list_deployments` até `finished`.

- [ ] **Step 4: Verificar**

```bash
D=http://dincx9erqdqpi0tqapejhgqs.31.97.249.115.sslip.io
curl -s $D/api/health                                   # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' $D/api/auth/me  # 401
curl -s -X POST $D/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"nao@existe.com","password":"x"}'         # {"error":"invalid_credentials"}
```
O agente não usa a senha real do admin. Pedir ao usuário que teste o próprio login:
```bash
curl -s -X POST http://dincx9erqdqpi0tqapejhgqs.31.97.249.115.sslip.io/api/auth/login -H 'content-type: application/json' -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}'
```
Expected: `{"user":{...,"role":"admin"}}`. Em seguida o usuário **remove `ADMIN_PASSWORD`** das variáveis do Coolify (o admin já existe; o bootstrap nunca sobrescreve a senha).

- [ ] **Step 5: Atualizar `docs/DEPLOY.md`**

Substituir a tabela de variáveis e a seção de backups por:
````markdown
## Banco de dados

- Postgres 16 `midora-db` no projeto `midora`, sem acesso público, limite 512 MB.
- Migrações (`apps/api/drizzle/`) são aplicadas automaticamente no start da aplicação.

## Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` / `HOST` | 3000 / `0.0.0.0` | definidos na imagem |
| `WEB_DIR` / `PLAYER_DIR` | `/app/web` / `/app/player` | definidos na imagem |
| `DATABASE_URL` | URL interna do `midora-db` | segredo, só no Coolify |
| `COOKIE_SECURE` | `false` | mudar para `true` quando houver HTTPS |
| `ADMIN_EMAIL` | e-mail do admin | usado só se o admin não existir |
| `ADMIN_PASSWORD` | — | definir só para criar o admin; remover depois |
| `LOG_LEVEL` | `info` | opcional |
| `APP_VERSION` | — | opcional; senão `SOURCE_COMMIT` ou `dev` |

## Backups e recuperação

- `midora-db`: backup diário 03:00 (Brasília), retenção 7, armazenado na VPS. Destino externo: pendente.
- Restaurar: Coolify → `midora-db` → Backups → escolher o backup → **Restore**; depois Redeploy da aplicação.
- Mídia (Etapa 2): procedimento será adicionado.
````

Commit e push na `main` (com aprovação do usuário):
```bash
git add docs/DEPLOY.md
git commit -m "docs: document database, env vars and backups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

## Critério de aceite da Etapa 1

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes local e no CI (job `docker` com Postgres real).
- Teste de isolamento (`partners.test.ts`) passa: parceiro A não lê nem altera dados de B; `partnerId` no corpo é rejeitado; player e parceiro não acessam rotas de admin.
- Produção: `/api/health` 200 com banco; `/api/auth/me` 401; admin consegue logar; `ADMIN_PASSWORD` removida do Coolify; backup diário configurado.

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
    const c = res.cookies.find((x) => x.name === 'kraken_session');
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
    expect((await getMe('kraken_session=forjado')).statusCode).toBe(401);
    const cookie = await login(app, 'gerente@ironberg.com', 'senha-forte-1');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, partnerUserId));
    expect((await getMe(cookie)).statusCode).toBe(401);
  });

  it('logout invalidates the session and clears the cookie', async () => {
    const cookie = await login(app, 'admin@midora.com', 'senha-admin-1');
    const res = await post('/api/auth/logout', undefined, cookie);
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((x) => x.name === 'kraken_session')?.value).toBe('');
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb, type Db } from '../src/db/client';
import { createTestDb } from './helpers/db';
import { createPartner, createUser, login } from './helpers/fixtures';

// A db whose every query fails like a real outage, with SQL in the message.
const brokenDb = new Proxy({}, {
  get: () => () => { throw new Error('Failed query: select * from users\nparams: secret-param'); },
}) as unknown as Db;

describe('error handling', () => {
  it('never leaks database error details to the client', async () => {
    const app = await buildApp({ version: 't', db: brokenDb });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.com', password: 'x' } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    expect(res.body).not.toContain('secret-param');
    await app.close();
  });

  it('health is 503 (not 500) when the db is down even with a session cookie', async () => {
    const app = await buildApp({ version: 't', db: brokenDb });
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie: 'midora_session=abc' } });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('database pool', () => {
  it('survives idle-client errors and has a connection timeout', async () => {
    const d = createDb('postgres://127.0.0.1:1/none');
    expect(() => d.pool.emit('error', new Error('terminated'))).not.toThrow();
    expect(d.pool.options.connectionTimeoutMillis).toBe(5000);
    await d.close();
  });
});

describe('with a real test database', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createTestDb()));
  afterAll(() => close());

  it('rate limits repeated logins for the same account', async () => {
    const p = await createPartner(db, 'rl');
    await createUser(db, { email: 'g@rl.com', password: 'senha-forte-1', role: 'partner_user', partnerId: p.id });
    const app = await buildApp({ version: 't', db });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'g@rl.com', password: 'errada' } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // other accounts are not affected
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'outro@rl.com', password: 'x' } })).statusCode).toBe(401);
    await app.close();
  });

  it('concurrent player-account creation does not fail with 500', async () => {
    const p = await createPartner(db, 'race');
    await createUser(db, { email: 'g@race.com', password: 'senha-forte-1', role: 'partner_user', partnerId: p.id });
    const app = await buildApp({ version: 't', db });
    const cookie = await login(app, 'g@race.com', 'senha-forte-1');
    const put = () => app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie }, payload: { password: 'senha-tv-123' } });
    const results = await Promise.all([put(), put(), put()]);
    expect(results.map((r) => r.statusCode).every((c) => c === 200)).toBe(true);
    await login(app, 'tv@race', 'senha-tv-123');
    await app.close();
  });
});

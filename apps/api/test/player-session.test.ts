import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';
import { loginTv } from './helpers/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;

const req = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
});
afterAll(() => t.close());

describe('TV session cookie', () => {
  it('signs the TV in with its own cookie, separate from the panel', async () => {
    const res = await req('POST', '/api/player/login', undefined, { email: 'tv@parceiro-a', password: 'senha-tv-123' });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.map((c) => c.name)).toEqual(['midora_tv']);
    const tv = `midora_tv=${res.cookies[0]!.value}`;
    expect((await req('GET', '/api/player/me', tv)).json().user).toMatchObject({ role: 'player' });
    expect((await req('GET', '/api/auth/me', tv)).statusCode).toBe(401);
  });

  it('lets the panel and the TV coexist in the same browser', async () => {
    const tv = await loginTv(t.app, 'tv@parceiro-a', 'senha-tv-123');
    const both = `${s.gerenteA}; ${tv}`;
    expect((await req('GET', '/api/partner', both)).statusCode).toBe(200);
    expect((await req('GET', '/api/player/manifest', both)).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/me', both)).json().user.role).toBe('partner_user');
  });

  it('rejects wrong passwords and non-TV accounts', async () => {
    expect((await req('POST', '/api/player/login', undefined, { email: 'tv@parceiro-a', password: 'errada' })).json()).toEqual({ error: 'invalid_credentials' });
    const res = await req('POST', '/api/player/login', undefined, { email: 'g@a.com', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'not_tv_account' });
    expect(res.cookies.find((c) => c.name === 'midora_tv')).toBeUndefined();
  });

  it('TV logout ends only the TV session', async () => {
    const tv = await loginTv(t.app, 'tv@parceiro-a', 'senha-tv-123');
    const both = `${s.gerenteA}; ${tv}`;
    const out = await req('POST', '/api/player/logout', both);
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'midora_tv')?.value).toBe('');
    expect((await req('GET', '/api/player/manifest', tv)).statusCode).toBe(401);
    expect((await req('GET', '/api/partner', s.gerenteA)).statusCode).toBe(200);
  });

  it('ignores a panel cookie on TV routes', async () => {
    expect((await req('GET', '/api/player/manifest', s.gerenteA)).statusCode).toBe(401);
  });
});

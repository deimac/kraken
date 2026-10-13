import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partners } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const post = (url: string, payload?: object, cookie?: string, ip = '10.1.0.1') =>
  t.app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {}, remoteAddress: ip });
const tvCookie = (res: Awaited<ReturnType<typeof post>>) => {
  const c = res.cookies.find((x) => x.name === 'kraken_tv');
  return c ? `kraken_tv=${c.value}` : undefined;
};

describe('TV access code', () => {
  it('partner generates a code that signs a TV in without user or password', async () => {
    const res = await post('/api/partner/player-code', undefined, s.gerenteA);
    expect(res.statusCode).toBe(200);
    const { code, path } = res.json();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(path).toBe(`/player/#${code}`);
    const partner = (await t.app.inject({ method: 'GET', url: '/api/partner', headers: { cookie: s.gerenteA } })).json().partner;
    expect(partner.tvCodeSet).toBe(true);
    expect(partner.tvCodeHash).toBeUndefined();

    // typed loosely on a TV remote: lowercase, without dashes
    const login = await post('/api/player/code-login', { code: code.replace(/-/g, '').toLowerCase() });
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({ role: 'player', partnerId: s.partnerA.id });
    const cookie = tvCookie(login)!;
    expect((await t.app.inject({ method: 'GET', url: '/api/player/manifest', headers: { cookie } })).statusCode).toBe(200);
  });

  it('a new code replaces the old one; TVs already signed in keep playing', async () => {
    const first = (await post('/api/partner/player-code', undefined, s.gerenteB)).json().code;
    const cookie = tvCookie(await post('/api/player/code-login', { code: first }))!;
    const second = (await post('/api/partner/player-code', undefined, s.gerenteB)).json().code;
    expect(second).not.toBe(first);
    expect((await post('/api/player/code-login', { code: first }, undefined, '10.1.0.2')).statusCode).toBe(401);
    const login = await post('/api/player/code-login', { code: second }, undefined, '10.1.0.2');
    expect(login.json().user.partnerId).toBe(s.partnerB.id);
    expect((await t.app.inject({ method: 'GET', url: '/api/player/manifest', headers: { cookie } })).statusCode).toBe(200);
  });

  it('rejects wrong codes, limits attempts and is partner-only to generate', async () => {
    expect((await post('/api/player/code-login', { code: 'AAAA-BBBB-CCCC-DDDD' }, undefined, '10.1.0.3')).json()).toEqual({ error: 'invalid_code' });
    expect((await post('/api/player/code-login', {}, undefined, '10.1.0.3')).statusCode).toBe(400);
    expect((await post('/api/partner/player-code', undefined, s.admin)).statusCode).toBe(403);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('/api/player/code-login', { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, undefined, '10.1.0.4')).statusCode;
    expect(last).toBe(429);
  });

  it('keeps the existing TV login name and password working', async () => {
    await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
    const res = await post('/api/player/login', { email: 'tv@parceiro-a', password: 'senha-tv-123' }, undefined, '10.1.0.5');
    expect(res.statusCode).toBe(200);
  });

  it('codes expire after 24 hours', async () => {
    const res = (await post('/api/partner/player-code', undefined, s.gerenteA)).json();
    expect(new Date(res.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    await t.db.update(partners).set({ tvCodeExpiresAt: new Date(Date.now() - 1000) }).where(eq(partners.id, s.partnerA.id));
    expect((await post('/api/player/code-login', { code: res.code }, undefined, '10.1.0.6')).json()).toEqual({ error: 'invalid_code' });
  });

  it('partner can disconnect every TV', async () => {
    const { code } = (await post('/api/partner/player-code', undefined, s.gerenteA)).json();
    const cookie = tvCookie(await post('/api/player/code-login', { code }, undefined, '10.1.0.7'))!;
    expect((await post('/api/partner/player-sessions/revoke', undefined, s.gerenteA)).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/player/manifest', headers: { cookie } })).statusCode).toBe(401);
  });

  it('never returns the code hash', async () => {
    const settings = await t.app.inject({ method: 'PATCH', url: '/api/partner/settings', headers: { cookie: s.gerenteA }, payload: { transitionMs: 600 } });
    expect(settings.json().partner.tvCodeHash).toBeUndefined();
    const list = await t.app.inject({ method: 'GET', url: '/api/admin/partners', headers: { cookie: s.admin } });
    expect(list.json().partners.every((p: Record<string, unknown>) => !('tvCodeHash' in p))).toBe(true);
  });

  it('direct access: once the partner turns it on, the TV signs in with just the address', async () => {
    const slugLogin = (slug: string, ip: string) => post('/api/player/open-login', { slug }, undefined, ip);
    expect((await slugLogin('parceiro-b', '10.1.1.1')).json()).toEqual({ error: 'direct_access_off' });
    const on = await t.app.inject({ method: 'PATCH', url: '/api/partner/settings', headers: { cookie: s.gerenteB }, payload: { playerOpen: true } });
    expect(on.json().partner.playerOpen).toBe(true);
    const res = await slugLogin('parceiro-b', '10.1.1.2');
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ role: 'player', partnerId: s.partnerB.id });
    expect((await t.app.inject({ method: 'GET', url: '/api/player/manifest', headers: { cookie: tvCookie(res)! } })).statusCode).toBe(200);
    expect((await slugLogin('nao-existe', '10.1.1.3')).json()).toEqual({ error: 'direct_access_off' });
  });
});

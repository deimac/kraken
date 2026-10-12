import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, sessions } from '../src/db/schema';
import { createTestApp, multipart, seed } from './helpers/app';
import { login } from './helpers/fixtures';
import { PNG_BYTES } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let tv: string;
let approvedMedia: string;
let draftMedia: string;

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

async function campaignWithImage(name: string, approve: boolean) {
  const plan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: `P ${name}`, frequencyLevel: 'high' })).json().plan.id;
  const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: `A ${name}` })).json().advertiser.id;
  const id = (await req('POST', '/api/campaigns', s.gerenteA, {
    advertiserId: adv, planId: plan, name, startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  const media = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/media`, headers: { cookie: s.gerenteA, ...m.headers }, payload: m.payload })).json().media.id;
  if (approve) {
    await req('POST', `/api/campaigns/${id}/submit`, s.gerenteA);
    await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA);
  }
  return { id, media };
}

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  approvedMedia = (await campaignWithImage('Aprovada', true)).media;
  draftMedia = (await campaignWithImage('Rascunho', false)).media;
  await req('PUT', '/api/partner/player-account', s.gerenteA, { password: 'senha-tv-123' });
  tv = await login(t.app, 'tv@parceiro-a', 'senha-tv-123');
});
afterAll(() => t.close());

describe('partner transition settings', () => {
  it('defaults to fade 600ms and can be changed by the partner only', async () => {
    expect((await req('GET', '/api/partner', s.gerenteA)).json().partner).toMatchObject({ transition: 'fade', transitionMs: 600 });
    const res = await req('PATCH', '/api/partner/settings', s.gerenteA, { transition: 'slide', transitionMs: 1000 });
    expect(res.json().partner).toMatchObject({ transition: 'slide', transitionMs: 1000 });
    expect((await req('PATCH', '/api/partner/settings', s.gerenteA, { transitionMs: 5000 })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/partner/settings', s.gerenteA, { transition: 'zoom' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/partner/settings', tv, { transition: 'cut' })).statusCode).toBe(403);
  });
});

describe('player manifest', () => {
  it('returns weights, transition and only eligible items with media URLs', async () => {
    const res = await req('GET', '/api/player/manifest', tv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.partner).toMatchObject({ weights: { low: 1, medium: 2, high: 3 }, transition: 'slide', transitionMs: 1000 });
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Aprovada']);
    expect(body.items[0].media).toMatchObject({ id: approvedMedia, url: `/api/media/${approvedMedia}`, mediaType: 'image' });
  });

  it('is only for TV accounts', async () => {
    expect((await req('GET', '/api/player/manifest', s.gerenteA)).statusCode).toBe(403);
    expect((await req('GET', '/api/player/manifest')).statusCode).toBe(401);
  });

  it('renews a TV session that is close to expiring', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await t.db.update(sessions).set({ expiresAt: soon });
    const res = await req('GET', '/api/player/manifest', tv);
    expect(res.cookies.find((c) => c.name === 'midora_session')).toBeTruthy();
    const rows = await t.db.select({ e: sessions.expiresAt }).from(sessions);
    expect(rows.some((r) => r.e.getTime() > Date.now() + 300 * 86_400_000)).toBe(true);
  });
});

describe('player media access', () => {
  it('serves eligible media to the TV but not drafts', async () => {
    expect((await req('GET', `/api/media/${approvedMedia}`, tv)).statusCode).toBe(200);
    expect((await req('GET', `/api/media/${draftMedia}`, tv)).statusCode).toBe(404);
    expect((await req('GET', `/api/media/${draftMedia}`, s.gerenteA)).statusCode).toBe(200);
  });

  it('stops serving media once the campaign is cancelled', async () => {
    const [c] = await t.db.select().from(campaigns).where(eq(campaigns.currentMediaId, approvedMedia));
    await req('POST', `/api/campaigns/${c!.id}/cancel`, s.gerenteA);
    expect((await req('GET', `/api/media/${approvedMedia}`, tv)).statusCode).toBe(404);
  });
});

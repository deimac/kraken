import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partners, plays } from '../src/db/schema';
import { createTestApp, multipart, seed } from './helpers/app';
import { loginTv, pj } from './helpers/fixtures';
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
  const adv = (await req('POST', '/api/partner/advertisers', cookie, { name: `A ${name}`, ...pj() })).json().advertiser.id;
  const id = (await req('POST', '/api/campaigns', cookie, {
    advertiserId: adv, planId: plan, name, startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  const media = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/pieces`, headers: { cookie, ...m.headers }, payload: m.payload })).json().piece.id;
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
  inst = { id: ic, media: (await t.app.inject({ method: 'POST', url: `/api/admin/campaigns/${ic}/pieces`, headers: { cookie: s.admin, ...m.headers }, payload: m.payload })).json().piece.id };
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

  it('corrects a TV clock that is off, using the time it says it sent the batch', async () => {
    const skew = 2 * 60 * 60_000; // TV runs two hours fast
    const tvNow = new Date(Date.now() + skew);
    const res = await req('POST', '/api/player/plays', tvA, {
      sentAt: tvNow.toISOString(),
      plays: [play(campA, ID(60), new Date(tvNow.getTime() - 60_000).toISOString())],
    });
    expect(res.json()).toEqual({ accepted: [ID(60)], rejected: [] });
    const [row] = await t.db.select().from(plays).where(eq(plays.id, ID(60)));
    expect(Math.abs(row!.playedAt.getTime() - (Date.now() - 60_000))).toBeLessThan(10_000);
  });

  it('is only for TVs', async () => {
    expect((await req('POST', '/api/player/plays', s.gerenteA, { plays: [play(campA, ID(50))] })).statusCode).toBe(401);
  });
});

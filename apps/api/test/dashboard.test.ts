import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { advertisers, campaigns, media, plans, plays } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';
import { createPartner, createUser, login, loginTv } from './helpers/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let advCookie: string;

const get = (url: string, cookie?: string) => t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const DAY = 86_400_000;
const now = Date.now();
/** Brasília calendar day (fixed -03:00) of an instant. */
const brDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);

async function subscription(partnerId: string, advertiserId: string, o: { status?: 'active' | 'paused' | 'cancelled'; endsIn?: number; pieces?: ('approved' | 'pending_review')[] } = {}) {
  const [plan] = await t.db.insert(plans).values({ partnerId, name: 'P', frequencyLevel: 'low' }).returning();
  const [c] = await t.db.insert(campaigns).values({
    kind: 'commercial', partnerId, advertiserId, planId: plan!.id, name: 'S', status: o.status ?? 'active', frequencyLevel: 'low',
    startsAt: new Date(now - 30 * DAY), endsAt: new Date(now + (o.endsIn ?? 90) * DAY),
  }).returning();
  const ids: string[] = [];
  for (const status of o.pieces ?? ['approved']) {
    const [m] = await t.db.insert(media).values({
      partnerId, campaignId: c!.id, storageKey: `k/${randomUUID()}`, mediaType: 'image', mime: 'image/png', sizeBytes: 1, sha256: 's',
      displaySeconds: 10, status,
    }).returning();
    ids.push(m!.id);
  }
  return { id: c!.id, media: ids[0]! };
}

async function record(sub: { id: string; media: string }, partnerId: string, at: number, count = 1) {
  await t.db.insert(plays).values(Array.from({ length: count }, () => ({
    id: randomUUID(), campaignId: sub.id, partnerId, mediaId: sub.media, mediaType: 'image' as const, playedAt: new Date(at),
  })));
}

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  const [advA] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Loja A', source: 'manual' }).returning();
  await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Arquivada', source: 'manual', archivedAt: new Date() });
  const [advB] = await t.db.insert(advertisers).values({ partnerId: s.partnerB.id, name: 'Loja B', source: 'manual' }).returning();
  const live = await subscription(s.partnerA.id, advA!.id, { pieces: ['approved', 'approved', 'pending_review'] });
  const expiring = await subscription(s.partnerA.id, advA!.id, { endsIn: 10 });
  await subscription(s.partnerA.id, advA!.id, { status: 'paused', endsIn: 5 });
  await subscription(s.partnerA.id, advA!.id, { pieces: ['pending_review'] }); // active but nothing approved: not on air
  await subscription(s.partnerA.id, advA!.id, { status: 'cancelled', endsIn: 5 });
  const other = await subscription(s.partnerB.id, advB!.id);
  await record(live, s.partnerA.id, now - 1000, 3);
  await record(expiring, s.partnerA.id, now - 2 * DAY, 2);
  await record(live, s.partnerA.id, now - 20 * DAY, 5);
  await record(other, s.partnerB.id, now - 1000, 7);
  await createUser(t.db, { email: 'adv@a.com', password: 'senha-forte-1', role: 'advertiser', partnerId: s.partnerA.id, advertiserId: advA!.id });
  advCookie = await login(t.app, 'adv@a.com', 'senha-forte-1');
});
afterAll(() => t.close());

describe('partner dashboard', () => {
  it('counts subscriptions, pieces, payments and plays in Brasília days', async () => {
    const body = (await get('/api/dashboard', s.gerenteA)).json();
    expect(body.role).toBe('partner');
    expect(body.stats).toMatchObject({
      live: 2, paused: 1, advertisers: 1, pendingPieces: 2, paymentPending: 3, playsToday: 3, plays7d: 5,
    });
    expect(body.expiring.map((e: { name: string }) => e.name)).toEqual(['S']);
    expect(body.days).toHaveLength(14);
    expect(body.days.at(-1)).toEqual({ day: brDay(now), count: 3 });
    expect(body.days.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(5);
  });

  it('reports the TV as not configured, then online after it fetches the manifest', async () => {
    expect((await get('/api/dashboard', s.gerenteA)).json().tv).toEqual({ configured: false, lastSeenAt: null, online: false });
    await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
    expect((await get('/api/dashboard', s.gerenteA)).json().tv).toMatchObject({ configured: true, online: false });
    const tv = await loginTv(t.app, 'tv@parceiro-a', 'senha-tv-123');
    await get('/api/player/manifest', tv);
    expect((await get('/api/dashboard', s.gerenteA)).json().tv).toMatchObject({ configured: true, online: true });
  });

  it('keeps partners apart', async () => {
    const body = (await get('/api/dashboard', s.gerenteB)).json();
    expect(body.stats).toMatchObject({ live: 1, playsToday: 7, advertisers: 1 });
  });
});

describe('advertiser and admin dashboards', () => {
  it('advertiser sees only its own subscriptions and plays', async () => {
    const body = (await get('/api/dashboard', advCookie)).json();
    expect(body.role).toBe('advertiser');
    expect(body.stats).toMatchObject({ live: 2, livePieces: 3, pendingPieces: 2, playsToday: 3, plays7d: 5 });
  });

  it('admin sees the whole network', async () => {
    const body = (await get('/api/dashboard', s.admin)).json();
    expect(body.role).toBe('admin');
    expect(body.stats).toMatchObject({ partners: 2, tvsTotal: 1, tvsOnline: 1, live: 3, playsToday: 10 });
  });

  it('requires a panel session', async () => {
    expect((await get('/api/dashboard')).statusCode).toBe(401);
  });
});

describe('Brasília day boundaries', () => {
  afterAll(() => vi.useRealTimers());

  it('counts a play at 23:30 in Brasília (02:30 UTC next day) on the Brasília day', async () => {
    const partner = await createPartner(t.db, 'fuso');
    await createUser(t.db, { email: 'g@fuso.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partner.id });
    const cookie = await login(t.app, 'g@fuso.com', 'senha-forte-1');
    const [adv] = await t.db.insert(advertisers).values({ partnerId: partner.id, name: 'F', source: 'manual' }).returning();
    const sub = await subscription(partner.id, adv!.id);
    await record(sub, partner.id, Date.parse('2026-10-14T02:30:00Z'), 4); // 13/10 23:30 in Brasília
    await record(sub, partner.id, Date.parse('2026-10-14T03:05:00Z'), 1); // 14/10 00:05 in Brasília
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T03:10:00Z') });
    const body = (await get('/api/dashboard', cookie)).json();
    vi.useRealTimers();
    expect(body.stats.playsToday).toBe(1);
    expect(body.days.slice(-2)).toEqual([{ day: '2026-10-13', count: 4 }, { day: '2026-10-14', count: 1 }]);
  });
});

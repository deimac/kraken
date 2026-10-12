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
    const lines = res.body.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('campanha;anunciante;tipo;dia;insercoes');
    expect(lines).toContain('Campanha A;Loja A;comercial;2026-10-10;5');
  });
});

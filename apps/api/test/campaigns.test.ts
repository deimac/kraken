import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listEligible } from '../src/campaigns/eligibility';
import { effectiveStatus } from '../src/campaigns/status';
import { createTestApp, multipart, seed } from './helpers/app';
import { pj } from './helpers/fixtures';
import { PNG_BYTES, buildMp4 } from './helpers/mp4';

// Commercial campaigns are "subscriptions" (assinaturas) in the panel: advertiser + plan + period, with pieces.
let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let planA: string;
let smallPlan: string;
let planB: string;
let advA: string;
let advCookie: string;
let advOtherCookie: string;

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

const signup = async (email: string) => {
  const res = await req('POST', '/api/public/partners/parceiro-a/advertisers', undefined, {
    companyName: `Empresa ${email}`, contactName: 'C', email, password: 'senha-anunc-1', ...pj(),
  });
  return `kraken_session=${res.cookies.find((c) => c.name === 'kraken_session')!.value}`;
};

const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' };
const png = { filename: 'banner.png', contentType: 'image/png', data: PNG_BYTES };
const mp4 = (durationMs = 10_000) => ({ filename: 'jeep.mp4', contentType: 'video/mp4', data: buildMp4({ durationMs }) });
const upload = (id: string, cookie: string, file: { filename: string; contentType: string; data: Buffer }) => {
  const m = multipart(file);
  return t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/pieces`, headers: { cookie, ...m.headers }, payload: m.payload });
};
const create = async (cookie: string, body: object = {}) =>
  (await req('POST', '/api/campaigns', cookie, { advertiserId: advA, planId: planA, ...period, ...body })).json().campaign;

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  planA = (await req('POST', '/api/partner/plans', s.gerenteA, {
    name: 'Ouro', frequencyLevel: 'high', maxVideos: 2, maxImages: 1, maxVideoSeconds: 30, priceCents: 30000,
  })).json().plan.id;
  smallPlan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Mini', frequencyLevel: 'low', maxVideos: 1, maxImages: 0 })).json().plan.id;
  planB = (await req('POST', '/api/partner/plans', s.gerenteB, { name: 'B', frequencyLevel: 'low' })).json().plan.id;
  advA = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Manual A', ...pj() })).json().advertiser.id;
  advCookie = await signup('anunc@x.com');
  advOtherCookie = await signup('outro@x.com');
});
afterAll(() => t.close());

describe('creating subscriptions', () => {
  it('partner creates an active subscription copying plan frequency and price, named after advertiser and plan', async () => {
    const res = await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, ...period });
    expect(res.statusCode).toBe(201);
    expect(res.json().campaign).toMatchObject({
      status: 'active', kind: 'commercial', frequencyLevel: 'high', priceCents: 30000, paymentStatus: 'pending', name: 'Manual A · Ouro',
    });
  });

  it('advertiser creates a paused subscription for itself only', async () => {
    const res = await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Minha', ...period });
    expect(res.json().campaign).toMatchObject({ status: 'paused', name: 'Minha' });
    expect((await req('POST', '/api/campaigns', advCookie, { advertiserId: advA, planId: planA, ...period })).statusCode).toBe(400);
  });

  it('rejects plans of another partner and bad periods', async () => {
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planB, ...period })).json()).toEqual({ error: 'invalid_plan' });
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' })).json()).toEqual({ error: 'invalid_period' });
    expect((await req('POST', '/api/campaigns', s.gerenteB, { advertiserId: advA, planId: planB, ...period })).statusCode).toBe(404);
  });

  it('lists with advertiser, plan and piece counts', async () => {
    const c = await create(s.gerenteA, { name: 'Contagem' });
    await upload(c.id, s.gerenteA, mp4());
    const list = (await req('GET', '/api/campaigns', s.gerenteA)).json().campaigns as Record<string, unknown>[];
    expect(list.find((x) => x.id === c.id)).toMatchObject({
      advertiserName: 'Manual A', planName: 'Ouro', pieces: { approved: 1, pending: 0 }, effectiveStatus: 'active',
    });
  });
});

describe('pieces', () => {
  it('partner pieces go live; detail shows plan usage, pieces and history', async () => {
    const c = await create(s.gerenteA, { name: 'Peças' });
    const v = await upload(c.id, s.gerenteA, mp4(15_000));
    expect(v.statusCode).toBe(201);
    expect(v.json().piece).toMatchObject({ status: 'approved', mediaType: 'video', originalName: 'jeep.mp4' });
    expect((await upload(c.id, s.gerenteA, png)).json().piece.status).toBe('approved');
    const detail = (await req('GET', `/api/campaigns/${c.id}`, s.gerenteA)).json();
    expect(detail.plan).toMatchObject({ name: 'Ouro', maxVideos: 2, maxImages: 1, maxVideoSeconds: 30 });
    expect(detail.usage).toEqual({ videos: 1, images: 1 });
    expect(detail.pieces).toHaveLength(2);
    expect(detail.reviews.map((r: { action: string }) => r.action)).toEqual(['created', 'piece_added', 'piece_added']);
    expect((await listEligible(t.db, s.partnerA.id)).filter((i) => i.campaignId === c.id)).toHaveLength(2);
  });

  it('enforces plan limits per type and maximum video duration', async () => {
    const c = await create(s.gerenteA, { name: 'Limites' });
    expect((await upload(c.id, s.gerenteA, png)).statusCode).toBe(201);
    const extraImage = await upload(c.id, s.gerenteA, png);
    expect(extraImage.statusCode).toBe(409);
    expect(extraImage.json()).toEqual({ error: 'plan_limit' });
    const long = await upload(c.id, s.gerenteA, mp4(31_000));
    expect(long.statusCode).toBe(422);
    expect(long.json()).toEqual({ error: 'video_too_long' });
    expect((await upload(c.id, s.gerenteA, mp4())).statusCode).toBe(201);
    expect((await upload(c.id, s.gerenteA, mp4())).statusCode).toBe(201);
    expect((await upload(c.id, s.gerenteA, mp4())).json()).toEqual({ error: 'plan_limit' });
  });

  it('accepts only one of two concurrent uploads for the last slot', async () => {
    const c = await create(s.gerenteA, { planId: smallPlan, name: 'Concorrência' });
    const [a, b] = await Promise.all([upload(c.id, s.gerenteA, mp4()), upload(c.id, s.gerenteA, mp4())]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });

  it('advertiser pieces wait for approval; partner approves or rejects with a reason', async () => {
    const c = (await req('POST', '/api/campaigns', advCookie, { planId: planA, ...period })).json().campaign;
    const p1 = (await upload(c.id, advCookie, mp4())).json().piece;
    expect(p1.status).toBe('pending_review');
    const p2 = (await upload(c.id, advCookie, png)).json().piece;
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p1.id}/approve`, advCookie)).statusCode).toBe(403);
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p1.id}/approve`, s.gerenteA)).json().piece.status).toBe('approved');
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p2.id}/reject`, s.gerenteA, {})).statusCode).toBe(400);
    const rejected = await req('POST', `/api/campaigns/${c.id}/pieces/${p2.id}/reject`, s.gerenteA, { reason: 'Logo cortado' });
    expect(rejected.json().piece).toMatchObject({ status: 'rejected', reviewReason: 'Logo cortado' });
    // a rejected piece frees its slot
    expect((await upload(c.id, advCookie, png)).statusCode).toBe(201);
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p1.id}/approve`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
  });

  it('removal: partner removes any piece; advertiser only its pending or rejected ones', async () => {
    const c = (await req('POST', '/api/campaigns', advCookie, { planId: planA, ...period })).json().campaign;
    const p = (await upload(c.id, advCookie, mp4())).json().piece;
    await req('POST', `/api/campaigns/${c.id}/pieces/${p.id}/approve`, s.gerenteA);
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p.id}/remove`, advCookie)).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p.id}/remove`, s.gerenteA)).json().piece.status).toBe('removed');
    const pending = (await upload(c.id, advCookie, mp4())).json().piece;
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${pending.id}/remove`, advCookie)).json().piece.status).toBe('removed');
    const detail = (await req('GET', `/api/campaigns/${c.id}`, advCookie)).json();
    expect(detail.pieces).toEqual([]);
  });

  it('approval re-checks the current plan limit', async () => {
    const c = (await req('POST', '/api/campaigns', advCookie, { planId: planA, ...period })).json().campaign;
    const first = (await upload(c.id, advCookie, mp4())).json().piece;
    const second = (await upload(c.id, advCookie, mp4())).json().piece;
    await req('PATCH', `/api/campaigns/${c.id}`, s.gerenteA, { planId: smallPlan });
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${first.id}/approve`, s.gerenteA)).statusCode).toBe(200);
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${second.id}/approve`, s.gerenteA)).json()).toEqual({ error: 'plan_limit' });
  });

  it('no uploads to cancelled subscriptions', async () => {
    const c = await create(s.gerenteA, { name: 'Cancelada' });
    await req('POST', `/api/campaigns/${c.id}/cancel`, s.gerenteA);
    expect((await upload(c.id, s.gerenteA, png)).json()).toEqual({ error: 'invalid_state' });
  });
});

describe('subscription lifecycle', () => {
  it('pause, resume, cancel and payment, partner only, with history', async () => {
    const c = await create(s.gerenteA, { name: 'Ciclo' });
    await upload(c.id, s.gerenteA, png);
    expect((await req('POST', `/api/campaigns/${c.id}/pause`, advCookie)).statusCode).toBe(403);
    expect((await req('POST', `/api/campaigns/${c.id}/pause`, s.gerenteA)).json().campaign.status).toBe('paused');
    expect((await listEligible(t.db, s.partnerA.id)).some((i) => i.campaignId === c.id)).toBe(false);
    expect((await req('POST', `/api/campaigns/${c.id}/pause`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${c.id}/resume`, s.gerenteA)).json().campaign.status).toBe('active');
    expect((await req('PATCH', `/api/campaigns/${c.id}/payment`, s.gerenteA, { paymentStatus: 'paid' })).json().campaign.paymentStatus).toBe('paid');
    expect((await req('PATCH', `/api/campaigns/${c.id}/payment`, advCookie, { paymentStatus: 'paid' })).statusCode).toBe(403);
    expect((await req('POST', `/api/campaigns/${c.id}/cancel`, s.gerenteA)).json().campaign.status).toBe('cancelled');
    expect((await req('POST', `/api/campaigns/${c.id}/resume`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
    const detail = (await req('GET', `/api/campaigns/${c.id}`, s.gerenteA)).json();
    expect(detail.reviews.map((r: { action: string }) => r.action)).toEqual(['created', 'piece_added', 'paused', 'resumed', 'payment', 'cancelled']);
  });

  it('partner edits name, period and plan; plan change copies frequency, keeps live pieces', async () => {
    const c = await create(s.gerenteA, { name: 'Editar' });
    await upload(c.id, s.gerenteA, mp4());
    await upload(c.id, s.gerenteA, mp4());
    const res = await req('PATCH', `/api/campaigns/${c.id}`, s.gerenteA, { planId: smallPlan, name: 'Editada' });
    expect(res.json().campaign).toMatchObject({ name: 'Editada', frequencyLevel: 'low' });
    const detail = (await req('GET', `/api/campaigns/${c.id}`, s.gerenteA)).json();
    expect(detail.usage).toEqual({ videos: 2, images: 0 });
    expect((await upload(c.id, s.gerenteA, mp4())).json()).toEqual({ error: 'plan_limit' });
    expect((await req('PATCH', `/api/campaigns/${c.id}`, advCookie, { name: 'x' })).statusCode).toBe(403);
  });
});

describe('isolation', () => {
  it('other partners get 404 and advertisers only see their own subscriptions and pieces', async () => {
    const c = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Privada', ...period })).json().campaign;
    const p = (await upload(c.id, advCookie, png)).json().piece;
    expect((await req('GET', `/api/campaigns/${c.id}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('POST', `/api/campaigns/${c.id}/pieces/${p.id}/approve`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('GET', `/api/campaigns/${c.id}`, advOtherCookie)).statusCode).toBe(404);
    expect((await upload(c.id, advOtherCookie, png)).statusCode).toBe(404);
    expect((await req('GET', `/api/media/${p.id}`, advOtherCookie)).statusCode).toBe(404);
    const otherList = (await req('GET', '/api/campaigns', advOtherCookie)).json().campaigns as { id: string }[];
    expect(otherList.map((x) => x.id)).not.toContain(c.id);
    expect((await req('GET', '/api/campaigns', s.gerenteB)).json().campaigns).toEqual([]);
  });
});

describe('effectiveStatus', () => {
  it('derives scheduled, active and ended for active subscriptions only', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const c = (status: 'active' | 'paused', startsAt: string, endsAt: string) => ({ status, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    expect(effectiveStatus(c('active', '2026-07-01', '2026-08-01'), now)).toBe('scheduled');
    expect(effectiveStatus(c('active', '2026-05-01', '2026-08-01'), now)).toBe('active');
    expect(effectiveStatus(c('active', '2026-01-01', '2026-06-01'), now)).toBe('ended');
    expect(effectiveStatus(c('paused', '2026-05-01', '2026-08-01'), now)).toBe('paused');
  });
});

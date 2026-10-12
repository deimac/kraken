import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectiveStatus } from '../src/campaigns/status';
import { campaigns } from '../src/db/schema';
import { createTestApp, multipart, seed } from './helpers/app';
import { PNG_BYTES } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let planA: string;
let planB: string;
let advA: string;
let advCookie: string;
let advOtherCookie: string;

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

const signup = async (email: string) => {
  const res = await req('POST', '/api/public/partners/parceiro-a/advertisers', undefined, {
    companyName: `Empresa ${email}`, contactName: 'C', email, password: 'senha-anunc-1',
  });
  return `midora_session=${res.cookies.find((c) => c.name === 'midora_session')!.value}`;
};

const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' };

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  planA = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Ouro', frequencyLevel: 'high' })).json().plan.id;
  planB = (await req('POST', '/api/partner/plans', s.gerenteB, { name: 'B', frequencyLevel: 'low' })).json().plan.id;
  advA = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Manual A' })).json().advertiser.id;
  advCookie = await signup('anunc@x.com');
  advOtherCookie = await signup('outro@x.com');
});
afterAll(() => t.close());

const uploadPng = (id: string, cookie: string) => {
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  return t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/media`, headers: { cookie, ...m.headers }, payload: m.payload });
};

describe('creating campaigns', () => {
  it('partner creates a draft for its advertiser with the plan frequency', async () => {
    const res = await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'Verão', ...period });
    expect(res.statusCode).toBe(201);
    expect(res.json().campaign).toMatchObject({ status: 'draft', kind: 'commercial', frequencyLevel: 'high', partnerId: s.partnerA.id });
  });

  it('advertiser creates for itself and cannot pick another advertiser', async () => {
    const res = await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Minha', ...period });
    expect(res.statusCode).toBe(201);
    expect((await req('POST', '/api/campaigns', advCookie, { advertiserId: advA, planId: planA, name: 'X', ...period })).statusCode).toBe(400);
  });

  it('rejects plans of another partner, inactive plans and bad periods', async () => {
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planB, name: 'X', ...period })).json()).toEqual({ error: 'invalid_plan' });
    expect((await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'X', startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' })).json()).toEqual({ error: 'invalid_period' });
    expect((await req('POST', '/api/campaigns', s.gerenteB, { advertiserId: advA, planId: planB, name: 'X', ...period })).statusCode).toBe(404);
  });
});

describe('approval flow', () => {
  it('submit → request changes → resubmit → approve, with history', async () => {
    const id = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Fluxo', ...period })).json().campaign.id;
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json()).toEqual({ error: 'media_required' });
    expect((await uploadPng(id, advCookie)).statusCode).toBe(201);
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json().campaign.status).toBe('pending_review');
    expect((await req('PATCH', `/api/campaigns/${id}`, advCookie, { name: 'mudou' })).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${id}/approve`, advCookie)).statusCode).toBe(403);
    expect((await req('POST', `/api/campaigns/${id}/request-changes`, s.gerenteA, {})).statusCode).toBe(400);
    expect((await req('POST', `/api/campaigns/${id}/request-changes`, s.gerenteA, { reason: 'Logo cortado' })).json().campaign.status).toBe('changes_requested');
    expect((await uploadPng(id, advCookie)).statusCode).toBe(201);
    expect((await req('POST', `/api/campaigns/${id}/submit`, advCookie)).json().campaign.status).toBe('pending_review');
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA)).json().campaign.status).toBe('approved');
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });

    const detail = (await req('GET', `/api/campaigns/${id}`, advCookie)).json();
    expect(detail.reviews.map((r: { action: string }) => r.action)).toEqual(['submitted', 'changes_requested', 'submitted', 'approved']);
    expect(detail.reviews[1].reason).toBe('Logo cortado');
    expect(detail.campaign.effectiveStatus).toBe('active');
    expect(detail.media.mediaType).toBe('image');
  });

  it('partner can cancel; cancelled cannot be resubmitted', async () => {
    const id = (await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: advA, planId: planA, name: 'Cancelar', ...period })).json().campaign.id;
    expect((await req('POST', `/api/campaigns/${id}/cancel`, s.gerenteA)).json().campaign.status).toBe('cancelled');
    expect((await req('POST', `/api/campaigns/${id}/cancel`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
    expect((await req('POST', `/api/campaigns/${id}/submit`, s.gerenteA)).json()).toEqual({ error: 'invalid_state' });
  });
});

describe('isolation', () => {
  it('other partners get 404 and advertisers only see their own campaigns', async () => {
    const id = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Privada', ...period })).json().campaign.id;
    expect((await req('GET', `/api/campaigns/${id}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('POST', `/api/campaigns/${id}/approve`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('GET', `/api/campaigns/${id}`, advOtherCookie)).statusCode).toBe(404);
    const otherList = (await req('GET', '/api/campaigns', advOtherCookie)).json().campaigns as { id: string }[];
    expect(otherList.map((c) => c.id)).not.toContain(id);
    const partnerList = (await req('GET', '/api/campaigns', s.gerenteA)).json().campaigns as { id: string }[];
    expect(partnerList.map((c) => c.id)).toContain(id);
    expect((await req('GET', '/api/campaigns', s.gerenteB)).json().campaigns).toEqual([]);
  });
});

describe('effectiveStatus', () => {
  it('derives scheduled, active and ended for approved campaigns only', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const c = (status: 'approved' | 'draft', startsAt: string, endsAt: string) => ({ status, startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    expect(effectiveStatus(c('approved', '2026-07-01', '2026-08-01'), now)).toBe('scheduled');
    expect(effectiveStatus(c('approved', '2026-05-01', '2026-08-01'), now)).toBe('active');
    expect(effectiveStatus(c('approved', '2026-01-01', '2026-06-01'), now)).toBe('ended');
    expect(effectiveStatus(c('draft', '2026-05-01', '2026-08-01'), now)).toBe('draft');
  });

  it('is stored as approved in the database', async () => {
    const rows = await t.db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.status, 'approved'));
    expect(rows.length).toBeGreaterThan(0);
  });
});

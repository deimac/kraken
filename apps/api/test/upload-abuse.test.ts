import { pj } from './helpers/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, multipart, seed } from './helpers/app';
import { PNG_BYTES } from './helpers/mp4';

async function setup(opts: Parameters<typeof createTestApp>[0]) {
  const t = await createTestApp(opts);
  const s = await seed(t.app, t.db);
  const req = (url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: { cookie: s.gerenteA }, payload: payload as object });
  const plan = (await req('/api/partner/plans', { name: 'P', frequencyLevel: 'low', maxImages: 50 })).json().plan.id;
  const adv = (await req('/api/partner/advertisers', { name: 'A', ...pj() })).json().advertiser.id;
  const id = (await req('/api/campaigns', {
    advertiserId: adv, planId: plan, name: 'C', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const upload = (query = '', fields?: Record<string, string>) => {
    const m = multipart({ filename: 'x.png', contentType: 'image/png', data: PNG_BYTES }, fields);
    return t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/pieces${query}`, headers: { cookie: s.gerenteA, ...m.headers }, payload: m.payload });
  };
  return { t, upload };
}

describe('upload abuse protection', () => {
  let a: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { a = await setup({ uploadsPerHour: 2 }); });
  afterAll(() => a.t.close());

  it('rate limits uploads per user', async () => {
    expect((await a.upload()).statusCode).toBe(201);
    expect((await a.upload()).statusCode).toBe(201);
    expect((await a.upload()).statusCode).toBe(429);
  });
});

describe('disk space guard', () => {
  let b: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { b = await setup({ minFreeBytes: Number.MAX_SAFE_INTEGER }); });
  afterAll(() => b.t.close());

  it('refuses uploads when free disk space is below the minimum', async () => {
    const res = await b.upload();
    expect(res.statusCode).toBe(507);
    expect(res.json()).toEqual({ error: 'storage_full' });
  });
});

describe('display seconds', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { c = await setup({}); });
  afterAll(() => c.t.close());

  it('is taken from the query string regardless of form field order', async () => {
    const res = await c.upload('?displaySeconds=30');
    expect(res.json().piece.displaySeconds).toBe(30);
  });
});

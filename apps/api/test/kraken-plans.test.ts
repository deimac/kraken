import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

describe('Kraken plans', () => {
  it('admin creates, lists and updates plans', async () => {
    const res = await req('POST', '/api/admin/kraken-plans', s.admin, { name: 'Essencial', description: 'Até 2 TVs', priceCents: 9900 });
    expect(res.statusCode).toBe(201);
    expect(res.json().plan).toMatchObject({ name: 'Essencial', priceCents: 9900, active: true });
    const id = res.json().plan.id;
    expect((await req('PATCH', `/api/admin/kraken-plans/${id}`, s.admin, { active: false, priceCents: null })).json().plan)
      .toMatchObject({ active: false, priceCents: null });
    expect((await req('GET', '/api/admin/kraken-plans', s.admin)).json().plans.map((p: { id: string }) => p.id)).toContain(id);
  });

  it('rejects negative prices and non-admins', async () => {
    expect((await req('POST', '/api/admin/kraken-plans', s.admin, { name: 'X', priceCents: -1 })).statusCode).toBe(400);
    expect((await req('GET', '/api/admin/kraken-plans', s.gerenteA)).statusCode).toBe(403);
    expect((await req('PATCH', '/api/admin/kraken-plans/00000000-0000-4000-8000-000000000000', s.admin, { name: 'Y' })).statusCode).toBe(404);
  });

  it('assigns and clears a partner plan', async () => {
    const plan = (await req('POST', '/api/admin/kraken-plans', s.admin, { name: 'Pro' })).json().plan;
    const upd = await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { krakenPlanId: plan.id });
    expect(upd.json().partner.krakenPlanId).toBe(plan.id);
    const bad = await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { krakenPlanId: '00000000-0000-4000-8000-000000000000' });
    expect(bad.json()).toEqual({ error: 'invalid_plan' });
    expect((await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { krakenPlanId: null })).json().partner.krakenPlanId).toBeNull();
  });
});

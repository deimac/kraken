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

describe('advertisers', () => {
  it('partner creates, lists and updates its advertisers', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Academia Sul', contactName: 'Ana', phone: '11 9999' });
    expect(res.statusCode).toBe(201);
    expect(res.json().advertiser).toMatchObject({ name: 'Academia Sul', source: 'manual', partnerId: s.partnerA.id });
    const id = res.json().advertiser.id;
    const upd = await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteA, { email: 'Ana@Sul.com' });
    expect(upd.json().advertiser.email).toBe('ana@sul.com');
    const list = await req('GET', '/api/partner/advertisers', s.gerenteA);
    expect(list.json().advertisers.map((a: { id: string }) => a.id)).toContain(id);
  });

  it('isolates advertisers between partners', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Só do A' });
    const id = res.json().advertiser.id;
    const listB = await req('GET', '/api/partner/advertisers', s.gerenteB);
    expect(listB.json().advertisers.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteB, { name: 'hack' })).statusCode).toBe(404);
  });
});

describe('plans', () => {
  it('partner manages plans and partners are isolated', async () => {
    const res = await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Ouro', description: 'Mais exibições', frequencyLevel: 'high' });
    expect(res.statusCode).toBe(201);
    const id = res.json().plan.id;
    expect(res.json().plan).toMatchObject({ frequencyLevel: 'high', active: true });
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteA, { active: false })).json().plan.active).toBe(false);
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteB, { active: true })).statusCode).toBe(404);
    expect((await req('POST', '/api/partner/plans', s.gerenteA, { name: 'X', frequencyLevel: 'max' })).statusCode).toBe(400);
  });
});

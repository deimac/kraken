import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { advertisers, campaigns, media, plans, plays, users } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';
import { createUser, login, pj } from './helpers/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

const CNPJ = '11222333000181';
const CPF = '52998224725';

describe('advertisers', () => {
  it('partner creates, lists and updates its advertisers', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, {
      name: 'Academia Sul', personType: 'pj', document: '11.222.333/0001-81', legalName: 'Academia Sul LTDA',
      contactName: 'Ana', phone: '11 9999', whatsapp: '11 98888-7777', zip: '01001-000', street: 'Praça da Sé',
      number: '1', district: 'Sé', city: 'São Paulo', state: 'SP', notes: 'cliente desde 2026',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().advertiser).toMatchObject({
      name: 'Academia Sul', source: 'manual', partnerId: s.partnerA.id, document: CNPJ, zip: '01001000', state: 'SP', archivedAt: null,
    });
    const id = res.json().advertiser.id;
    const upd = await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteA, { email: 'Ana@Sul.com' });
    expect(upd.json().advertiser.email).toBe('ana@sul.com');
    const list = await req('GET', '/api/partner/advertisers', s.gerenteA);
    const item = list.json().advertisers.find((a: { id: string }) => a.id === id);
    expect(item).toMatchObject({ activeCampaigns: 0 });
  });

  it('requires a valid document matching the person type on create', async () => {
    expect((await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Sem doc' })).statusCode).toBe(400);
    const bad = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'X', personType: 'pj', document: CPF });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_document');
    const pf = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Maria', personType: 'pf', document: '529.982.247-25' });
    expect(pf.statusCode).toBe(201);
    expect((await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'X', personType: 'pj', document: CNPJ, state: 'XX' })).statusCode).toBe(400);
  });

  it('rejects duplicated documents within a partner only', async () => {
    const doc = '45.723.174/0001-10';
    expect((await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'D1', personType: 'pj', document: doc })).statusCode).toBe(201);
    const dup = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'D2', personType: 'pj', document: doc });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('document_taken');
    expect((await req('POST', '/api/partner/advertisers', s.gerenteB, { name: 'D3', personType: 'pj', document: doc })).statusCode).toBe(201);
  });

  it('edits legacy advertisers without a document and validates document changes', async () => {
    const [legacy] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Antigo', source: 'manual' }).returning();
    const upd = await req('PATCH', `/api/partner/advertisers/${legacy!.id}`, s.gerenteA, { phone: '11 5555-0000' });
    expect(upd.statusCode).toBe(200);
    expect((await req('PATCH', `/api/partner/advertisers/${legacy!.id}`, s.gerenteA, { document: '123' })).json().error).toBe('invalid_document');
    expect((await req('PATCH', `/api/partner/advertisers/${legacy!.id}`, s.gerenteA, { personType: 'pf', document: '11144477735' })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/partner/advertisers/${legacy!.id}`, s.gerenteA, { personType: 'pj' })).json().error).toBe('invalid_document');
  });

  it('searches by name and by formatted document, and filters archived', async () => {
    const doc = '60.701.190/0001-04';
    const id = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Padaria Pão Bom', personType: 'pj', document: doc })).json().advertiser.id;
    const byName = await req('GET', '/api/partner/advertisers?q=pão', s.gerenteA);
    expect(byName.json().advertisers.map((a: { id: string }) => a.id)).toEqual([id]);
    const byDoc = await req('GET', `/api/partner/advertisers?q=${encodeURIComponent('60.701.190')}`, s.gerenteA);
    expect(byDoc.json().advertisers.map((a: { id: string }) => a.id)).toEqual([id]);
    expect((await req('POST', `/api/partner/advertisers/${id}/archive`, s.gerenteA)).json().advertiser.archivedAt).toBeTruthy();
    expect((await req('GET', '/api/partner/advertisers?q=pão', s.gerenteA)).json().advertisers).toEqual([]);
    const archived = await req('GET', '/api/partner/advertisers?archived=1', s.gerenteA);
    expect(archived.json().advertisers.map((a: { id: string }) => a.id)).toEqual([id]);
    expect((await req('POST', `/api/partner/advertisers/${id}/unarchive`, s.gerenteA)).json().advertiser.archivedAt).toBeNull();
  });

  it('shows detail with campaigns and plays this month', async () => {
    const [adv] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Com plays', source: 'manual' }).returning();
    const [plan] = await t.db.insert(plans).values({ partnerId: s.partnerA.id, name: 'P', frequencyLevel: 'low' }).returning();
    const now = new Date();
    const [c] = await t.db.insert(campaigns).values({
      kind: 'commercial', partnerId: s.partnerA.id, advertiserId: adv!.id, planId: plan!.id, name: 'Camp', status: 'active',
      frequencyLevel: 'low', startsAt: new Date(now.getTime() - 864e5), endsAt: new Date(now.getTime() + 864e5),
    }).returning();
    const [m] = await t.db.insert(media).values({
      partnerId: s.partnerA.id, campaignId: c!.id, storageKey: `k/${c!.id}`, mediaType: 'image', mime: 'image/png',
      sizeBytes: 1, durationMs: null, sha256: 'x', displaySeconds: 10,
    }).returning();
    await t.db.insert(plays).values([
      { id: randomUUID(), campaignId: c!.id, partnerId: s.partnerA.id, mediaId: m!.id, mediaType: 'image', playedAt: now },
      { id: randomUUID(), campaignId: c!.id, partnerId: s.partnerA.id, mediaId: m!.id, mediaType: 'image', playedAt: now },
      { id: randomUUID(), campaignId: c!.id, partnerId: s.partnerA.id, mediaId: m!.id, mediaType: 'image', playedAt: new Date('2020-01-01') },
    ]);
    const res = await req('GET', `/api/partner/advertisers/${adv!.id}`, s.gerenteA);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ advertiser: { id: adv!.id }, playsThisMonth: 2, campaigns: [{ id: c!.id, effectiveStatus: 'active' }] });
    const list = await req('GET', '/api/partner/advertisers?q=Com plays', s.gerenteA);
    expect(list.json().advertisers[0].activeCampaigns).toBe(1);
    const del = await req('DELETE', `/api/partner/advertisers/${adv!.id}`, s.gerenteA);
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('has_subscriptions');
  });

  it('deletes an advertiser without campaigns together with its login', async () => {
    const [adv] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Apagar', source: 'self_signup' }).returning();
    await createUser(t.db, { email: 'apagar@a.com', password: 'senha-forte-1', role: 'advertiser', partnerId: s.partnerA.id, advertiserId: adv!.id });
    const cookie = await login(t.app, 'apagar@a.com', 'senha-forte-1');
    expect((await req('DELETE', `/api/partner/advertisers/${adv!.id}`, s.gerenteA)).statusCode).toBe(204);
    expect(await t.db.select().from(users).where(eq(users.email, 'apagar@a.com'))).toEqual([]);
    expect((await req('GET', '/api/auth/me', cookie)).statusCode).toBe(401);
    expect((await req('GET', `/api/partner/advertisers/${adv!.id}`, s.gerenteA)).statusCode).toBe(404);
  });

  it('saves a legacy advertiser edited through the form (personType resent, no document)', async () => {
    const [legacy] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Legado', source: 'manual' }).returning();
    const res = await req('PATCH', `/api/partner/advertisers/${legacy!.id}`, s.gerenteA, { name: 'Legado', personType: 'pj', phone: '1155550000', contactName: null });
    expect(res.statusCode).toBe(200);
  });

  it('does not count campaigns of archived advertisers as on air', async () => {
    const [adv] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Arquivado no ar', source: 'manual' }).returning();
    const [plan] = await t.db.insert(plans).values({ partnerId: s.partnerA.id, name: 'P2', frequencyLevel: 'low' }).returning();
    const now = Date.now();
    await t.db.insert(campaigns).values({
      kind: 'commercial', partnerId: s.partnerA.id, advertiserId: adv!.id, planId: plan!.id, name: 'C', status: 'active',
      frequencyLevel: 'low', startsAt: new Date(now - 864e5), endsAt: new Date(now + 864e5),
    });
    await req('POST', `/api/partner/advertisers/${adv!.id}/archive`, s.gerenteA);
    const [paused] = await t.db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.advertiserId, adv!.id));
    expect(paused!.status).toBe('paused');
    await req('POST', `/api/partner/advertisers/${adv!.id}/unarchive`, s.gerenteA);
    const [still] = await t.db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.advertiserId, adv!.id));
    expect(still!.status).toBe('paused'); // unarchiving does not put anything back on air by itself
    await req('POST', `/api/partner/advertisers/${adv!.id}/archive`, s.gerenteA);
    const list = await req('GET', '/api/partner/advertisers?archived=1&q=Arquivado no ar', s.gerenteA);
    expect(list.json().advertisers[0].activeCampaigns).toBe(0);
    const created = await req('POST', '/api/campaigns', s.gerenteA, {
      advertiserId: adv!.id, planId: plan!.id, name: 'Nova', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 864e5).toISOString(),
    });
    expect(created.statusCode).toBe(409);
    expect(created.json().error).toBe('advertiser_archived');
  });

  it('isolates advertisers between partners', async () => {
    const res = await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Só do A', personType: 'pf', document: '39053344705' });
    const id = res.json().advertiser.id;
    const listB = await req('GET', '/api/partner/advertisers', s.gerenteB);
    expect(listB.json().advertisers.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await req('PATCH', `/api/partner/advertisers/${id}`, s.gerenteB, { name: 'hack' })).statusCode).toBe(404);
    expect((await req('GET', `/api/partner/advertisers/${id}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('POST', `/api/partner/advertisers/${id}/archive`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('DELETE', `/api/partner/advertisers/${id}`, s.gerenteB)).statusCode).toBe(404);
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

describe('plan limits and pricing', () => {
  it('stores limits, price and period with defaults for omitted fields', async () => {
    const res = await req('POST', '/api/partner/plans', s.gerenteA, {
      name: 'Vitrine', frequencyLevel: 'medium', maxVideos: 2, maxImages: 3, maxVideoSeconds: 30, priceCents: 30000, periodMonths: 6,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().plan).toMatchObject({ maxVideos: 2, maxImages: 3, maxVideoSeconds: 30, priceCents: 30000, periodMonths: 6 });
    const plain = await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Simples', frequencyLevel: 'low' });
    expect(plain.json().plan).toMatchObject({ maxVideos: 1, maxImages: 1, maxVideoSeconds: 30, priceCents: 0, periodMonths: 1 });
  });

  it('rejects invalid limits, considering saved values on PATCH', async () => {
    expect((await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Z', frequencyLevel: 'low', maxVideos: 0, maxImages: 0 })).json().error).toBe('invalid_limits');
    expect((await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Z', frequencyLevel: 'low', periodMonths: 2 })).statusCode).toBe(400);
    expect((await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Z', frequencyLevel: 'low', maxVideoSeconds: 3 })).statusCode).toBe(400);
    const id = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Só vídeo', frequencyLevel: 'low', maxVideos: 1, maxImages: 0 })).json().plan.id;
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteA, { maxVideos: 0 })).json().error).toBe('invalid_limits');
    expect((await req('PATCH', `/api/partner/plans/${id}`, s.gerenteA, { name: 'Só vídeo 2' })).json().plan.name).toBe('Só vídeo 2');
  });

  it('archives and unarchives, hiding archived plans from new campaigns', async () => {
    const id = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Arquivável', frequencyLevel: 'low' })).json().plan.id;
    expect((await req('POST', `/api/partner/plans/${id}/archive`, s.gerenteA)).json().plan.active).toBe(false);
    expect((await req('POST', `/api/partner/plans/${id}/archive`, s.gerenteB)).statusCode).toBe(404);
    const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'Adv plano', ...pj() })).json().advertiser.id;
    const now = Date.now();
    const camp = await req('POST', '/api/campaigns', s.gerenteA, {
      advertiserId: adv, planId: id, name: 'X', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 864e5).toISOString(),
    });
    expect(camp.json().error).toBe('invalid_plan');
    expect((await req('POST', `/api/partner/plans/${id}/unarchive`, s.gerenteA)).json().plan.active).toBe(true);
  });
});

describe('advertiser plans', () => {
  it('lists only active plans of the advertiser partner', async () => {
    await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Prata', frequencyLevel: 'medium' });
    const off = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Desligado', frequencyLevel: 'low' })).json().plan.id;
    await req('PATCH', `/api/partner/plans/${off}`, s.gerenteA, { active: false });
    await req('POST', '/api/partner/plans', s.gerenteB, { name: 'Do B', frequencyLevel: 'high' });
    const [adv] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Adv', source: 'manual' }).returning();
    await createUser(t.db, { email: 'adv@a.com', password: 'senha-forte-1', role: 'advertiser', partnerId: s.partnerA.id, advertiserId: adv!.id });
    const cookie = await login(t.app, 'adv@a.com', 'senha-forte-1');
    const names = (await req('GET', '/api/advertiser/plans', cookie)).json().plans.map((p: { name: string }) => p.name);
    expect(names).toContain('Prata');
    expect(names).not.toContain('Desligado');
    expect(names).not.toContain('Do B');
  });
});

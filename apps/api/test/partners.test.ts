import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Db } from '../src/db/client';
import { createTestDb } from './helpers/db';
import { createPartner, createUser, login } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let admin: string;
let gerenteA: string;
let gerenteB: string;
let partnerA: { id: string; slug: string };
let partnerB: { id: string; slug: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  partnerA = await createPartner(db, 'parceiro-a');
  partnerB = await createPartner(db, 'parceiro-b');
  await createUser(db, { email: 'admin@kraken.com', password: 'senha-admin-1', role: 'admin' });
  await createUser(db, { email: 'g@a.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerA.id });
  await createUser(db, { email: 'g@b.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerB.id });
  app = await buildApp({ version: 't', db });
  admin = await login(app, 'admin@kraken.com', 'senha-admin-1');
  gerenteA = await login(app, 'g@a.com', 'senha-forte-1');
  gerenteB = await login(app, 'g@b.com', 'senha-forte-1');
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

describe('admin partner management', () => {
  it('creates, lists and updates partners', async () => {
    const created = await req('POST', '/api/admin/partners', admin, { name: 'Ironberg', slug: 'ironberg' });
    expect(created.statusCode).toBe(201);
    const id = created.json().partner.id;
    expect(created.json().partner).toMatchObject({ slug: 'ironberg', status: 'active', showInstitutional: false });

    const list = await req('GET', '/api/admin/partners', admin);
    expect(list.json().partners.map((p: { slug: string }) => p.slug)).toContain('ironberg');

    const upd = await req('PATCH', `/api/admin/partners/${id}`, admin, { showInstitutional: true, weightHigh: 5 });
    expect(upd.json().partner).toMatchObject({ showInstitutional: true, weightHigh: 5 });
  });

  it('rejects duplicate and invalid slugs', async () => {
    expect((await req('POST', '/api/admin/partners', admin, { name: 'X', slug: 'parceiro-a' })).json())
      .toEqual({ error: 'slug_taken' });
    expect((await req('POST', '/api/admin/partners', admin, { name: 'X', slug: 'Com Espaço' })).statusCode).toBe(400);
  });

  it('returns 404 for unknown partner ids', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await req('PATCH', `/api/admin/partners/${id}`, admin, { name: 'Y' })).statusCode).toBe(404);
    expect((await req('POST', `/api/admin/partners/${id}/users`, admin, { email: 'n@n.com', password: 'senha-forte-1' })).statusCode).toBe(404);
  });

  it('creates partner users and rejects duplicate e-mails case-insensitively', async () => {
    const res = await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'Novo@A.com', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'novo@a.com', role: 'partner_user', partnerId: partnerA.id });
    const dup = await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'NOVO@a.com', password: 'senha-forte-1' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'email_taken' });
  });

  it('rejects short passwords', async () => {
    expect((await req('POST', `/api/admin/partners/${partnerA.id}/users`, admin, { email: 'c@a.com', password: '123' })).statusCode).toBe(400);
  });
});

describe('isolation between partners', () => {
  it('each partner user sees only its own partner and users', async () => {
    expect((await req('GET', '/api/partner', gerenteA)).json().partner.id).toBe(partnerA.id);
    expect((await req('GET', '/api/partner', gerenteB)).json().partner.id).toBe(partnerB.id);
    const usersA = (await req('GET', '/api/partner/users', gerenteA)).json().users as { email: string }[];
    expect(usersA.map((u) => u.email)).not.toContain('g@b.com');
    expect(usersA.map((u) => u.email)).toContain('g@a.com');
  });

  it('partner users cannot use admin routes', async () => {
    expect((await req('GET', '/api/admin/partners', gerenteA)).statusCode).toBe(403);
    expect((await req('PATCH', `/api/admin/partners/${partnerB.id}`, gerenteA, { name: 'hack' })).statusCode).toBe(403);
    expect((await req('POST', `/api/admin/partners/${partnerB.id}/users`, gerenteA, { email: 'x@b.com', password: 'senha-forte-1' })).statusCode).toBe(403);
  });

  it('rejects attempts to target another partner through the body', async () => {
    const res = await req('PUT', '/api/partner/player-account', gerenteA, { password: 'senha-tv-123', partnerId: partnerB.id });
    expect(res.statusCode).toBe(400);
  });

  it('requires a session for partner routes', async () => {
    expect((await req('GET', '/api/partner')).statusCode).toBe(401);
  });
});

describe('player account', () => {
  it('creates the TV login, lets it sign in, and is forbidden on partner routes', async () => {
    const res = await req('PUT', '/api/partner/player-account', gerenteA, { password: 'senha-tv-123' });
    expect(res.json()).toEqual({ login: 'tv@parceiro-a' });
    const tv = await login(app, 'tv@parceiro-a', 'senha-tv-123');
    const me = await req('GET', '/api/auth/me', tv);
    expect(me.json().user).toMatchObject({ role: 'player', partnerId: partnerA.id });
    expect((await req('GET', '/api/partner', tv)).statusCode).toBe(403);
    expect((await req('GET', '/api/admin/partners', tv)).statusCode).toBe(403);
  });

  it('changing the password signs out existing TVs of that partner only', async () => {
    await req('PUT', '/api/partner/player-account', gerenteB, { password: 'senha-tv-b-1' });
    const tvA = await login(app, 'tv@parceiro-a', 'senha-tv-123');
    const tvB = await login(app, 'tv@parceiro-b', 'senha-tv-b-1');
    await req('PUT', '/api/partner/player-account', gerenteA, { password: 'nova-senha-tv-1' });
    expect((await req('GET', '/api/auth/me', tvA)).statusCode).toBe(401);
    expect((await req('GET', '/api/auth/me', tvB)).statusCode).toBe(200);
    await login(app, 'tv@parceiro-a', 'nova-senha-tv-1');
  });
});

describe('deactivating a partner', () => {
  it('immediately ends its sessions and blocks new logins', async () => {
    const p = await createPartner(db, 'parceiro-c');
    await createUser(db, { email: 'g@c.com', password: 'senha-forte-1', role: 'partner_user', partnerId: p.id });
    const gerenteC = await login(app, 'g@c.com', 'senha-forte-1');
    await req('PATCH', `/api/admin/partners/${p.id}`, admin, { status: 'inactive' });
    expect((await req('GET', '/api/partner', gerenteC)).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'g@c.com', password: 'senha-forte-1' } });
    expect(res.statusCode).toBe(401);
  });
});

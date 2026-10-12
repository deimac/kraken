import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, verifyPassword } from '../src/auth/password';
import {
  SESSION_TTL_MS, createSession, deleteSession, deleteUserSessions, findSessionUser,
} from '../src/auth/sessions';
import type { Db } from '../src/db/client';
import { partners, sessions } from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { createPartner, createUser } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

describe('password', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse');
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword(h, 'correct horse')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('dummyVerify always resolves false', async () => {
    expect(await dummyVerify('anything')).toBe(false);
  });
});

describe('sessions', () => {
  it('stores only the token hash and resolves the user', async () => {
    const p = await createPartner(db, 's1');
    const u = await createUser(db, { email: 'u@s1.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const { token, expiresAt } = await createSession(db, u);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(token);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS.staff - 60_000);
    expect(await findSessionUser(db, token)).toEqual({
      id: u.id, email: 'u@s1.com', role: 'partner_user', partnerId: p.id, advertiserId: null,
    });
  });

  it('gives players a long session', async () => {
    const p = await createPartner(db, 's2');
    const tv = await createUser(db, { email: 'tv@s2', password: 'password1', role: 'player', partnerId: p.id });
    const { expiresAt } = await createSession(db, tv);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS.player - 60_000);
  });

  it('returns null for unknown, expired and deleted sessions', async () => {
    const p = await createPartner(db, 's3');
    const u = await createUser(db, { email: 'u@s3.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    expect(await findSessionUser(db, 'forged-token')).toBeNull();

    const { token } = await createSession(db, u);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, u.id));
    expect(await findSessionUser(db, token)).toBeNull();

    const s2 = await createSession(db, u);
    await deleteSession(db, s2.token);
    expect(await findSessionUser(db, s2.token)).toBeNull();
  });

  it('returns null when the partner is inactive, but admins have no partner', async () => {
    const p = await createPartner(db, 's4');
    const u = await createUser(db, { email: 'u@s4.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const { token } = await createSession(db, u);
    await db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, p.id));
    expect(await findSessionUser(db, token)).toBeNull();

    const admin = await createUser(db, { email: 'adm@s4.com', password: 'password1', role: 'admin' });
    const a = await createSession(db, admin);
    expect((await findSessionUser(db, a.token))?.role).toBe('admin');
  });

  it('deleteUserSessions removes all sessions of one user only', async () => {
    const p = await createPartner(db, 's5');
    const u1 = await createUser(db, { email: 'a@s5.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const u2 = await createUser(db, { email: 'b@s5.com', password: 'password1', role: 'partner_user', partnerId: p.id });
    const t1 = await createSession(db, u1);
    const t1b = await createSession(db, u1);
    const t2 = await createSession(db, u2);
    await deleteUserSessions(db, u1.id);
    expect(await findSessionUser(db, t1.token)).toBeNull();
    expect(await findSessionUser(db, t1b.token)).toBeNull();
    expect(await findSessionUser(db, t2.token)).not.toBeNull();
  });
});

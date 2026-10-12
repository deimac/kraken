import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { partners, sessions, users, type Role } from '../db/schema';

const DAY_MS = 86_400_000;
export const SESSION_TTL_MS = { staff: 30 * DAY_MS, player: 365 * DAY_MS };

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  partnerId: string | null;
  advertiserId: string | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, user: { id: string; role: Role }) {
  const token = randomBytes(32).toString('base64url');
  const ttl = user.role === 'player' ? SESSION_TTL_MS.player : SESSION_TTL_MS.staff;
  const expiresAt = new Date(Date.now() + ttl);
  await db.insert(sessions).values({ id: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt };
}

export async function findSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      partnerId: users.partnerId,
      advertiserId: users.advertiserId,
      partnerStatus: partners.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (row.role !== 'admin' && row.partnerStatus !== 'active') return null;
  return { id: row.id, email: row.email, role: row.role, partnerId: row.partnerId, advertiserId: row.advertiserId };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

const RENEW_BELOW_MS = 180 * DAY_MS;

/** Slides a long-lived session forward when it is getting close to expiry. Returns the new expiry, if renewed. */
export async function renewSession(db: Db, token: string): Promise<Date | null> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS.player);
  const [row] = await db
    .update(sessions)
    .set({ expiresAt })
    .where(and(eq(sessions.id, hashToken(token)), lt(sessions.expiresAt, new Date(Date.now() + RENEW_BELOW_MS))))
    .returning({ id: sessions.id });
  return row ? expiresAt : null;
}

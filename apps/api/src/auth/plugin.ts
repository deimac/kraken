import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { ROLES, partners, users } from '../db/schema';
import { parse } from '../http/validation';
import { requireRole } from './guard';
import { dummyVerify, verifyPassword } from './password';
import { createSession, deleteSession, findSessionUser, type SessionUser } from './sessions';

export const SESSION_COOKIE = 'midora_session';
/** TV players keep their own session so a panel login in the same browser doesn't replace it. */
export const TV_COOKIE = 'midora_tv';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  cookieSecure: boolean,
  name: string = SESSION_COOKIE,
) {
  reply.setCookie(name, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure, expires: expiresAt,
  });
}

export const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

// 10 attempts per minute per client IP and e-mail: slows guessing without locking out others.
export const LOGIN_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: (req: { ip: string; body?: unknown }) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return `${req.ip}|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
  },
};

/** The user for these credentials, or null (unknown e-mail, wrong password or inactive partner). */
export async function checkCredentials(db: Db, email: string, password: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      partnerId: users.partnerId,
      advertiserId: users.advertiserId,
      passwordHash: users.passwordHash,
      partnerStatus: partners.status,
    })
    .from(users)
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .where(eq(users.email, email))
    .limit(1);
  const valid = user ? await verifyPassword(user.passwordHash, password) : await dummyVerify(password);
  if (!user || !valid || (user.role !== 'admin' && user.partnerStatus !== 'active')) return null;
  const { id, role, partnerId, advertiserId } = user;
  return { id, email: user.email, role, partnerId, advertiserId };
}

export async function registerAuth(
  app: FastifyInstance,
  { db, cookieSecure }: { db: Db; cookieSecure: boolean },
): Promise<void> {
  await app.register(cookie);
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return;
    const panel = req.cookies[SESSION_COOKIE];
    const tv = req.cookies[TV_COOKIE];
    if (req.url.startsWith('/api/player/')) {
      if (tv) req.user = await findSessionUser(db, tv);
      return;
    }
    if (panel) req.user = await findSessionUser(db, panel);
    // Media is used by both the panel and the player.
    if (!req.user && tv && req.url.startsWith('/api/media/')) req.user = await findSessionUser(db, tv);
  });

  app.post('/api/auth/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (req, reply) => {
    const body = parse(LoginBody, req.body, reply);
    if (!body) return reply;
    const user = await checkCredentials(db, body.email, body.password);
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
    const { token, expiresAt } = await createSession(db, user);
    setSessionCookie(reply, token, expiresAt, cookieSecure);
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireRole(...ROLES) }, async (req) => ({ user: req.user }));
}

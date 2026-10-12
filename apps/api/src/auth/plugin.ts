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

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, cookieSecure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure, expires: expiresAt,
  });
}

const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

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
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = await findSessionUser(db, token);
  });

  // 10 attempts per minute per client IP and e-mail: slows guessing without locking out others.
  const loginRateLimit = {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req: { ip: string; body?: unknown }) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return `${req.ip}|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
    },
  };

  app.post('/api/auth/login', { config: { rateLimit: loginRateLimit } }, async (req, reply) => {
    const body = parse(LoginBody, req.body, reply);
    if (!body) return reply;
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
      .where(eq(users.email, body.email))
      .limit(1);
    const valid = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await dummyVerify(body.password);
    if (!user || !valid || (user.role !== 'admin' && user.partnerStatus !== 'active')) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const { token, expiresAt } = await createSession(db, user);
    setSessionCookie(reply, token, expiresAt, cookieSecure);
    const { id, email, role, partnerId, advertiserId } = user;
    return { user: { id, email, role, partnerId, advertiserId } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireRole(...ROLES) }, async (req) => ({ user: req.user }));
}

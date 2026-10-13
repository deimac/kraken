import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../auth/guard';
import { LOGIN_RATE_LIMIT, LoginBody, TV_COOKIE, checkCredentials, setSessionCookie } from '../auth/plugin';
import { createSession, deleteSession, renewSession } from '../auth/sessions';
import { listEligible } from '../campaigns/eligibility';
import type { Db } from '../db/client';
import { partners } from '../db/schema';
import { parse } from '../http/validation';

export const playerRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean; version?: string }> = async (app, { db, cookieSecure, version }) => {
  app.post('/api/player/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (req, reply) => {
    const body = parse(LoginBody, req.body, reply);
    if (!body) return reply;
    const user = await checkCredentials(db, body.email, body.password);
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
    if (user.role !== 'player') return reply.code(403).send({ error: 'not_tv_account' });
    const { token, expiresAt } = await createSession(db, user);
    setSessionCookie(reply, token, expiresAt, cookieSecure, TV_COOKIE);
    return { user };
  });

  app.post('/api/player/logout', async (req, reply) => {
    const token = req.cookies[TV_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(TV_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/player/me', { preHandler: requireRole('player') }, async (req) => ({ user: req.user }));

  app.get('/api/player/manifest', { preHandler: requireRole('player') }, async (req, reply) => {
    const partnerId = req.user!.partnerId!;
    const [p] = await db
      .select({
        name: partners.name,
        weightLow: partners.weightLow,
        weightMedium: partners.weightMedium,
        weightHigh: partners.weightHigh,
        transition: partners.transition,
        transitionMs: partners.transitionMs,
      })
      .from(partners)
      .where(eq(partners.id, partnerId));
    // TVs stay on for months: keep their session alive while they keep polling.
    const token = req.cookies[TV_COOKIE];
    if (token) {
      const renewed = await renewSession(db, token);
      if (renewed) setSessionCookie(reply, token, renewed, cookieSecure, TV_COOKIE);
    }
    // "TV online" on the dashboard; written at most once a minute per partner.
    await db
      .update(partners)
      .set({ tvLastSeenAt: new Date() })
      .where(and(eq(partners.id, partnerId), or(isNull(partners.tvLastSeenAt), lt(partners.tvLastSeenAt, new Date(Date.now() - 60_000)))));
    const items = await listEligible(db, partnerId);
    return {
      partner: {
        name: p!.name,
        weights: { low: p!.weightLow, medium: p!.weightMedium, high: p!.weightHigh },
        transition: p!.transition,
        transitionMs: p!.transitionMs,
      },
      items: items.map((i) => ({ ...i, media: { ...i.media, url: `/api/media/${i.media.id}` } })),
      generatedAt: new Date().toISOString(),
      version,
    };
  });
};

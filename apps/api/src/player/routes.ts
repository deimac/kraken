import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../auth/guard';
import { SESSION_COOKIE, setSessionCookie } from '../auth/plugin';
import { renewSession } from '../auth/sessions';
import { listEligible } from '../campaigns/eligibility';
import type { Db } from '../db/client';
import { partners } from '../db/schema';

export const playerRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean }> = async (app, { db, cookieSecure }) => {
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
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const renewed = await renewSession(db, token);
      if (renewed) setSessionCookie(reply, token, renewed, cookieSecure);
    }
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
    };
  });
};

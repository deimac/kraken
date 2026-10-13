import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { parse } from '../http/validation';

const MAX_PER_PARTNER = 100;

const Batch = z
  .object({
    events: z
      .array(
        z
          .object({
            kind: z.string().min(1).max(40),
            mediaId: z.uuid().optional(),
            detail: z.string().max(300).optional(),
            at: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

type TvEvent = z.infer<typeof Batch>['events'][number] & { userAgent: string | null; receivedAt: string };

/**
 * What went wrong on the partner's TVs (videos that do not load, playback refused, stalls), so problems on a
 * device nobody can see from here can be diagnosed from the panel. Kept in memory: the latest events only,
 * lost on restart — this is a troubleshooting aid, not a record.
 */
export const tvEventRoutes: FastifyPluginAsync = async (app) => {
  const byPartner = new Map<string, TvEvent[]>();

  app.post('/api/player/events', { preHandler: requireRole('player') }, async (req, reply) => {
    const body = parse(Batch, req.body, reply);
    if (!body) return reply;
    const partnerId = req.user!.partnerId!;
    const userAgent = req.headers['user-agent']?.slice(0, 200) ?? null;
    const receivedAt = new Date().toISOString();
    const list = byPartner.get(partnerId) ?? [];
    list.push(...body.events.map((e) => ({ ...e, userAgent, receivedAt })));
    byPartner.set(partnerId, list.slice(-MAX_PER_PARTNER));
    return reply.code(204).send();
  });

  app.get('/api/partner/tv-events', { preHandler: requireRole('partner_user') }, async (req) => ({
    events: [...(byPartner.get(req.user!.partnerId!) ?? [])].reverse(),
  }));
};

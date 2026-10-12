import { eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { campaigns, media, plays } from '../db/schema';
import { parse } from '../http/validation';

const MAX_AGE_MS = 90 * 86_400_000;
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

const Batch = z
  .object({
    plays: z
      .array(
        z
          .object({ id: z.uuid(), campaignId: z.uuid(), mediaId: z.uuid(), playedAt: z.iso.datetime({ offset: true }) })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const playRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post('/api/player/plays', { preHandler: requireRole('player') }, async (req, reply) => {
    const body = parse(Batch, req.body, reply);
    if (!body) return reply;
    const partnerId = req.user!.partnerId!;
    const mediaIds = [...new Set(body.plays.map((p) => p.mediaId))];
    const known = await db
      .select({
        id: media.id,
        campaignId: media.campaignId,
        mediaType: media.mediaType,
        owner: campaigns.partnerId,
        kind: campaigns.kind,
      })
      .from(media)
      .innerJoin(campaigns, eq(campaigns.id, media.campaignId))
      .where(inArray(media.id, mediaIds));
    const byId = new Map(known.map((m) => [m.id, m]));
    const now = Date.now();

    const accepted: string[] = [];
    const rejected: string[] = [];
    const rows: (typeof plays.$inferInsert)[] = [];
    for (const p of body.plays) {
      const m = byId.get(p.mediaId);
      const at = new Date(p.playedAt).getTime();
      const ok =
        m !== undefined &&
        m.campaignId === p.campaignId &&
        (m.owner === partnerId || m.kind === 'institutional') &&
        at >= now - MAX_AGE_MS &&
        at <= now + MAX_CLOCK_AHEAD_MS;
      if (!ok) {
        rejected.push(p.id);
        continue;
      }
      accepted.push(p.id);
      rows.push({ id: p.id, campaignId: p.campaignId, partnerId, mediaId: p.mediaId, mediaType: m.mediaType, playedAt: new Date(at) });
    }
    // Resends are expected (the TV may have lost the response): duplicates are kept once.
    if (rows.length) await db.insert(plays).values(rows).onConflictDoNothing({ target: plays.id });
    return { accepted, rejected };
  });
};

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { ROLES, campaigns, media } from '../db/schema';
import { parse } from '../http/validation';
import type { LocalStorage } from '../storage/local';

const IdParams = z.object({ id: z.uuid() });

function canRead(user: SessionUser, m: { partnerId: string | null }, advertiserId: string | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'advertiser') return advertiserId !== null && advertiserId === user.advertiserId;
  // partner users and players: own partner's media, plus Midora institutional media
  return m.partnerId === null || m.partnerId === user.partnerId;
}

export const mediaRoutes: FastifyPluginAsync<{ db: Db; storage: LocalStorage }> = async (app, { db, storage }) => {
  app.get('/api/media/:id', { preHandler: requireRole(...ROLES) }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const [row] = await db
      .select({ m: media, advertiserId: campaigns.advertiserId })
      .from(media)
      .innerJoin(campaigns, eq(campaigns.id, media.campaignId))
      .where(eq(media.id, params.id));
    if (!row || !canRead(req.user!, row.m, row.advertiserId)) return reply.code(404).send({ error: 'not_found' });
    const m = row.m;
    const size = m.sizeBytes;
    const etag = `"${m.sha256}"`;
    reply
      .header('content-type', m.mime)
      .header('accept-ranges', 'bytes')
      .header('etag', etag)
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const range = req.headers.range;
    if (!range) {
      reply.header('content-length', size);
      return reply.send(storage.createReadStream(m.storageKey));
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = -1;
    let end = -1;
    if (match && (match[1] !== '' || match[2] !== '')) {
      if (match[1] === '') {
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
      }
    }
    if (start < 0 || start > end || start >= size) {
      return reply.code(416).header('content-range', `bytes */${size}`).send();
    }
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
    return reply.send(storage.createReadStream(m.storageKey, { start, end }));
  });
};

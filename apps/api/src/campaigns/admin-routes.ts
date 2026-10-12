import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { FREQUENCY_LEVELS, campaigns } from '../db/schema';
import { parse } from '../http/validation';
import { attachMedia } from '../media/attach';
import { receiveUpload, uploadRateLimit, type UploadLimits } from '../media/upload';
import type { LocalStorage } from '../storage/local';
import { transition, withStatus } from './routes';

const IdParams = z.object({ id: z.uuid() });
const MediaQuery = z.object({ displaySeconds: z.string().optional() });
const DateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const CreateInstitutional = z
  .object({
    name: z.string().trim().min(1).max(120),
    frequencyLevel: z.enum(FREQUENCY_LEVELS),
    startsAt: DateTime,
    endsAt: DateTime,
  })
  .strict();

export const adminCampaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits }> = async (
  app,
  { db, storage, uploadLimits },
) => {
  app.addHook('preHandler', requireRole('admin'));

  const load = async (id: string) => {
    const [c] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.kind, 'institutional')));
    return c;
  };

  app.get('/api/admin/campaigns', async () => ({
    campaigns: (
      await db.select().from(campaigns).where(eq(campaigns.kind, 'institutional')).orderBy(desc(campaigns.createdAt))
    ).map(withStatus),
  }));

  app.post('/api/admin/campaigns', async (req, reply) => {
    const body = parse(CreateInstitutional, req.body, reply);
    if (!body) return reply;
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ error: 'invalid_period' });
    const [campaign] = await db
      .insert(campaigns)
      .values({ ...body, kind: 'institutional', status: 'approved' })
      .returning();
    return reply.code(201).send({ campaign: withStatus(campaign!) });
  });

  app.post('/api/admin/campaigns/:id/media', { config: uploadRateLimit(uploadLimits) }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const query = parse(MediaQuery, req.query, reply);
    if (!query) return reply;
    if (!storage || !uploadLimits) return reply.code(503).send({ error: 'storage_unavailable' });
    const c = await load(params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const upload = await receiveUpload(req, storage, uploadLimits);
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error });
    const result = await attachMedia(db, storage, c, upload, { allowedStatuses: ['approved'], displaySeconds: query.displaySeconds });
    if (result === 'invalid_display_seconds') return reply.code(400).send({ error: 'invalid_request' });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return reply.code(201).send({ media: result });
  });

  app.post('/api/admin/campaigns/:id/cancel', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await load(params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['approved'], to: 'cancelled', action: 'cancelled', actorUserId: req.user!.id,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });
};

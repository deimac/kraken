import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { advertisers, campaignReviews, campaigns, media, plans, type CampaignStatus } from '../db/schema';
import { parse } from '../http/validation';
import { attachMedia } from '../media/attach';
import { receiveUpload, uploadRateLimit, type UploadLimits } from '../media/upload';
import type { LocalStorage } from '../storage/local';
import { effectiveStatus } from './status';

const IdParams = z.object({ id: z.uuid() });
const MediaQuery = z.object({ displaySeconds: z.string().optional() });
const DateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const CreateCampaign = z
  .object({
    advertiserId: z.uuid().optional(),
    planId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    startsAt: DateTime,
    endsAt: DateTime,
  })
  .strict();
const UpdateCampaign = z
  .object({ name: z.string().trim().min(1).max(120), planId: z.uuid(), startsAt: DateTime, endsAt: DateTime })
  .partial()
  .strict();
const RequestChanges = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

const EDITABLE: CampaignStatus[] = ['draft', 'changes_requested'];

type Campaign = typeof campaigns.$inferSelect;
type ReviewAction = 'submitted' | 'approved' | 'changes_requested' | 'cancelled';

function scope(user: SessionUser): SQL {
  return user.role === 'advertiser'
    ? eq(campaigns.advertiserId, user.advertiserId!)
    : eq(campaigns.partnerId, user.partnerId!);
}

export async function loadScopedCampaign(db: Db, user: SessionUser, id: string): Promise<Campaign | undefined> {
  const [c] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.kind, 'commercial'), scope(user)));
  return c;
}

/** Atomic status change + history row. Returns undefined when the campaign is not in `from`. */
export async function transition(
  db: Db,
  opts: { id: string; from: CampaignStatus[]; to: CampaignStatus; action: ReviewAction; actorUserId: string; reason?: string },
): Promise<Campaign | undefined> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(campaigns)
      .set({ status: opts.to, updatedAt: new Date() })
      .where(and(eq(campaigns.id, opts.id), inArray(campaigns.status, opts.from)))
      .returning();
    if (!c) return undefined;
    await tx.insert(campaignReviews).values({
      campaignId: c.id, action: opts.action, reason: opts.reason ?? null, actorUserId: opts.actorUserId,
    });
    return c;
  });
}

export const withStatus = (c: Campaign) => ({ ...c, effectiveStatus: effectiveStatus(c) });

const campaignWithAdvertiser = { campaign: campaigns, advertiserName: advertisers.name };
const flatten = (r: { campaign: Campaign; advertiserName: string | null }) => ({
  ...withStatus(r.campaign),
  advertiserName: r.advertiserName ?? '',
});

export const campaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits }> = async (
  app,
  { db, storage, uploadLimits },
) => {
  const anyOwner = { preHandler: requireRole('partner_user', 'advertiser') };
  const partnerOnly = { preHandler: requireRole('partner_user') };

  const activePlan = async (partnerId: string, planId: string) => {
    const [p] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.partnerId, partnerId), eq(plans.active, true)));
    return p;
  };

  app.get('/api/campaigns', anyOwner, async (req) => {
    const rows = await db
      .select(campaignWithAdvertiser)
      .from(campaigns)
      .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
      .where(and(eq(campaigns.kind, 'commercial'), scope(req.user!)))
      .orderBy(desc(campaigns.createdAt));
    return { campaigns: rows.map(flatten) };
  });

  app.get('/api/campaigns/:id', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const [current] = c.currentMediaId ? await db.select().from(media).where(eq(media.id, c.currentMediaId)) : [];
    const reviews = await db
      .select({
        action: campaignReviews.action,
        reason: campaignReviews.reason,
        actorUserId: campaignReviews.actorUserId,
        createdAt: campaignReviews.createdAt,
      })
      .from(campaignReviews)
      .where(eq(campaignReviews.campaignId, c.id))
      .orderBy(asc(campaignReviews.createdAt), asc(campaignReviews.id));
    const [adv] = await db.select({ name: advertisers.name }).from(advertisers).where(eq(advertisers.id, c.advertiserId!));
    return { campaign: { ...withStatus(c), advertiserName: adv?.name ?? '' }, media: current ?? null, reviews };
  });

  app.post('/api/campaigns', anyOwner, async (req, reply) => {
    const body = parse(CreateCampaign, req.body, reply);
    if (!body) return reply;
    const user = req.user!;
    let advertiserId: string;
    if (user.role === 'advertiser') {
      if (body.advertiserId) return reply.code(400).send({ error: 'invalid_request' });
      advertiserId = user.advertiserId!;
    } else {
      if (!body.advertiserId) return reply.code(400).send({ error: 'invalid_request' });
      advertiserId = body.advertiserId;
    }
    const [adv] = await db
      .select({ id: advertisers.id, archivedAt: advertisers.archivedAt })
      .from(advertisers)
      .where(and(eq(advertisers.id, advertiserId), eq(advertisers.partnerId, user.partnerId!)));
    if (!adv) return reply.code(404).send({ error: 'not_found' });
    if (adv.archivedAt) return reply.code(409).send({ error: 'advertiser_archived' });
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ error: 'invalid_period' });
    const plan = await activePlan(user.partnerId!, body.planId);
    if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        kind: 'commercial', partnerId: user.partnerId!, advertiserId, planId: plan.id, name: body.name,
        startsAt: body.startsAt, endsAt: body.endsAt, frequencyLevel: plan.frequencyLevel,
      })
      .returning();
    return reply.code(201).send({ campaign: withStatus(campaign!) });
  });

  app.patch('/api/campaigns/:id', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateCampaign, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (!EDITABLE.includes(c.status)) return reply.code(409).send({ error: 'invalid_state' });
    const startsAt = body.startsAt ?? c.startsAt;
    const endsAt = body.endsAt ?? c.endsAt;
    if (endsAt <= startsAt) return reply.code(400).send({ error: 'invalid_period' });
    let frequencyLevel = c.frequencyLevel;
    if (body.planId) {
      const plan = await activePlan(c.partnerId!, body.planId);
      if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
      frequencyLevel = plan.frequencyLevel;
    }
    const [campaign] = await db
      .update(campaigns)
      .set({ ...body, frequencyLevel, updatedAt: new Date() })
      .where(and(eq(campaigns.id, c.id), inArray(campaigns.status, EDITABLE)))
      .returning();
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/media', { ...anyOwner, config: uploadRateLimit(uploadLimits) }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const query = parse(MediaQuery, req.query, reply);
    if (!query) return reply;
    if (!storage || !uploadLimits) return reply.code(503).send({ error: 'storage_unavailable' });
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (!EDITABLE.includes(c.status)) return reply.code(409).send({ error: 'invalid_state' });
    const upload = await receiveUpload(req, storage, uploadLimits);
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error });
    const result = await attachMedia(db, storage, c, upload, { allowedStatuses: EDITABLE, displaySeconds: query.displaySeconds });
    if (result === 'invalid_display_seconds') return reply.code(400).send({ error: 'invalid_request' });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return reply.code(201).send({ media: result });
  });

  app.post('/api/campaigns/:id/submit', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (EDITABLE.includes(c.status) && !c.currentMediaId) return reply.code(409).send({ error: 'media_required' });
    const campaign = await transition(db, {
      id: c.id, from: EDITABLE, to: 'pending_review', action: 'submitted', actorUserId: req.user!.id,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/approve', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['pending_review'], to: 'approved', action: 'approved', actorUserId: req.user!.id,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/request-changes', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(RequestChanges, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['pending_review'], to: 'changes_requested', action: 'changes_requested',
      actorUserId: req.user!.id, reason: body.reason,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/cancel', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await transition(db, {
      id: c.id, from: ['draft', 'pending_review', 'changes_requested', 'approved'], to: 'cancelled',
      action: 'cancelled', actorUserId: req.user!.id,
    });
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });
};

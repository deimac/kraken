import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import {
  PAYMENT_STATUSES, REVIEW_ACTIONS, advertisers, campaignReviews, campaigns, media, plans, plays,
  type CampaignStatus, type PieceStatus,
} from '../db/schema';
import { parse } from '../http/validation';
import { OCCUPYING, addPiece, type AddPieceResult } from '../media/pieces';
import { receiveUpload, uploadRateLimit, type UploadLimits } from '../media/upload';
import type { LocalStorage } from '../storage/local';
import type { TvOptimizer } from '../media/tv-optimize';
import { effectiveStatus } from './status';

// Commercial campaigns are shown to people as "subscriptions" (assinaturas): advertiser + plan + period, with pieces.
const IdParams = z.object({ id: z.uuid() });
const PieceParams = z.object({ id: z.uuid(), pieceId: z.uuid() });
const MediaQuery = z.object({ displaySeconds: z.string().optional() });
const DateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const Name = z.string().trim().min(1).max(120);
const CreateCampaign = z
  .object({ advertiserId: z.uuid().optional(), planId: z.uuid(), name: Name.optional(), startsAt: DateTime, endsAt: DateTime })
  .strict();
const UpdateCampaign = z.object({ name: Name, planId: z.uuid(), startsAt: DateTime, endsAt: DateTime }).partial().strict();
const Payment = z.object({ paymentStatus: z.enum(PAYMENT_STATUSES) }).strict();
const Reject = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

type Campaign = typeof campaigns.$inferSelect;
type ReviewAction = (typeof REVIEW_ACTIONS)[number];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

export const logEvent = (
  db: Db | Tx,
  e: { campaignId: string; action: ReviewAction; actorUserId: string; mediaId?: string; reason?: string | null },
) => db.insert(campaignReviews).values({ ...e, mediaId: e.mediaId ?? null, reason: e.reason ?? null });

/** Atomic status change + history row. Returns undefined when the campaign is not in `from`. */
export async function transition(
  db: Db,
  opts: { id: string; from: CampaignStatus[]; to: CampaignStatus; action: ReviewAction; actorUserId: string },
): Promise<Campaign | undefined> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(campaigns)
      .set({ status: opts.to, updatedAt: new Date() })
      .where(and(eq(campaigns.id, opts.id), inArray(campaigns.status, opts.from)))
      .returning();
    if (!c) return undefined;
    await logEvent(tx, { campaignId: c.id, action: opts.action, actorUserId: opts.actorUserId });
    return c;
  });
}

/** What the panel needs to show a piece. */
export const PIECE = {
  id: media.id, mediaType: media.mediaType, mime: media.mime, durationMs: media.durationMs, displaySeconds: media.displaySeconds,
  status: media.status, reviewReason: media.reviewReason, originalName: media.originalName, createdAt: media.createdAt,
};

/** Atomic piece status change + history row. Returns undefined when the piece is not in `from`. */
export async function changePiece(
  db: Db,
  opts: {
    campaignId: string; pieceId: string; from: PieceStatus[]; to: PieceStatus; action: ReviewAction; actorUserId: string;
    reason?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [piece] = await tx
      .update(media)
      .set({ status: opts.to, ...(opts.reason !== undefined ? { reviewReason: opts.reason } : {}) })
      .where(and(eq(media.id, opts.pieceId), eq(media.campaignId, opts.campaignId), inArray(media.status, opts.from)))
      .returning(PIECE);
    if (!piece) return undefined;
    await logEvent(tx, {
      campaignId: opts.campaignId, mediaId: piece.id, action: opts.action, actorUserId: opts.actorUserId, reason: opts.reason,
    });
    return piece;
  });
}

export const withStatus = (c: Campaign) => ({ ...c, effectiveStatus: effectiveStatus(c) });

export const pieceCount = (status: PieceStatus) =>
  sql<number>`(select count(*)::int from ${media} m where m.campaign_id = "campaigns"."id" and m.status = ${status})`;

/** Maps addPiece outcomes to HTTP answers. */
export function sendPieceResult(reply: FastifyReply, result: AddPieceResult) {
  if (result === 'invalid_display_seconds') return reply.code(400).send({ error: 'invalid_request' });
  if (result === 'invalid_state') return reply.code(409).send({ error: 'invalid_state' });
  if (result === 'plan_limit') return reply.code(409).send({ error: 'plan_limit' });
  if (result === 'video_too_long') return reply.code(422).send({ error: 'video_too_long' });
  const { id, mediaType, mime, durationMs, displaySeconds, status, reviewReason, originalName, createdAt } = result;
  return reply.code(201).send({ piece: { id, mediaType, mime, durationMs, displaySeconds, status, reviewReason, originalName, createdAt } });
}

export const campaignRoutes: FastifyPluginAsync<{ db: Db; storage?: LocalStorage; uploadLimits?: UploadLimits; tvOptimizer?: TvOptimizer }> = async (
  app,
  { db, storage, uploadLimits, tvOptimizer },
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

  /** Loads the subscription in the user's scope and checks the piece belongs to it; replies 404 otherwise. */
  const loadPiece = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = parse(PieceParams, req.params, reply);
    if (!params) return null;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    const [piece] = c
      ? await db.select({ id: media.id }).from(media).where(and(eq(media.id, params.pieceId), eq(media.campaignId, c.id)))
      : [];
    if (!c || !piece) {
      reply.code(404).send({ error: 'not_found' });
      return null;
    }
    return { c, pieceId: piece.id };
  };

  app.get('/api/campaigns', anyOwner, async (req) => {
    const rows = await db
      .select({
        campaign: campaigns, advertiserName: advertisers.name, planName: plans.name,
        approved: pieceCount('approved'), pending: pieceCount('pending_review'),
      })
      .from(campaigns)
      .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
      .leftJoin(plans, eq(plans.id, campaigns.planId))
      .where(and(eq(campaigns.kind, 'commercial'), scope(req.user!)))
      .orderBy(desc(campaigns.createdAt));
    return {
      campaigns: rows.map((r) => ({
        ...withStatus(r.campaign),
        advertiserName: r.advertiserName ?? '',
        planName: r.planName ?? '',
        pieces: { approved: r.approved, pending: r.pending },
      })),
    };
  });

  app.get('/api/campaigns/:id', anyOwner, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const [adv] = await db.select({ name: advertisers.name }).from(advertisers).where(eq(advertisers.id, c.advertiserId!));
    const [plan] = await db
      .select({
        id: plans.id, name: plans.name, frequencyLevel: plans.frequencyLevel, maxVideos: plans.maxVideos, maxImages: plans.maxImages,
        maxVideoSeconds: plans.maxVideoSeconds, periodMonths: plans.periodMonths,
      })
      .from(plans)
      .where(eq(plans.id, c.planId!));
    const pieces = await db
      .select(PIECE)
      .from(media)
      .where(and(eq(media.campaignId, c.id), ne(media.status, 'removed')))
      .orderBy(asc(media.createdAt), asc(media.id));
    const occupying = pieces.filter((p) => OCCUPYING.includes(p.status));
    const reviews = await db
      .select({
        action: campaignReviews.action, reason: campaignReviews.reason, mediaId: campaignReviews.mediaId,
        actorUserId: campaignReviews.actorUserId, createdAt: campaignReviews.createdAt,
      })
      .from(campaignReviews)
      .where(eq(campaignReviews.campaignId, c.id))
      .orderBy(asc(campaignReviews.createdAt), asc(campaignReviews.id));
    const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(plays).where(eq(plays.campaignId, c.id));
    return {
      campaign: { ...withStatus(c), advertiserName: adv?.name ?? '', planName: plan?.name ?? '' },
      plan: plan ?? null,
      pieces,
      usage: {
        videos: occupying.filter((p) => p.mediaType === 'video').length,
        images: occupying.filter((p) => p.mediaType === 'image').length,
      },
      reviews,
      totalPlays: total?.n ?? 0,
    };
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
      .select({ id: advertisers.id, name: advertisers.name, archivedAt: advertisers.archivedAt })
      .from(advertisers)
      .where(and(eq(advertisers.id, advertiserId), eq(advertisers.partnerId, user.partnerId!)));
    if (!adv) return reply.code(404).send({ error: 'not_found' });
    if (adv.archivedAt) return reply.code(409).send({ error: 'advertiser_archived' });
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ error: 'invalid_period' });
    const plan = await activePlan(user.partnerId!, body.planId);
    if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
    const campaign = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(campaigns)
        .values({
          kind: 'commercial', partnerId: user.partnerId!, advertiserId, planId: plan.id, name: body.name ?? `${adv.name} · ${plan.name}`,
          startsAt: body.startsAt, endsAt: body.endsAt, frequencyLevel: plan.frequencyLevel, priceCents: plan.priceCents,
          // An advertiser's own subscription waits for the partner to put it on air.
          status: user.role === 'advertiser' ? 'paused' : 'active',
        })
        .returning();
      await logEvent(tx, { campaignId: c!.id, action: 'created', actorUserId: user.id });
      return c!;
    });
    return reply.code(201).send({ campaign: withStatus(campaign) });
  });

  app.patch('/api/campaigns/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateCampaign, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (c.status === 'cancelled') return reply.code(409).send({ error: 'invalid_state' });
    const startsAt = body.startsAt ?? c.startsAt;
    const endsAt = body.endsAt ?? c.endsAt;
    if (endsAt <= startsAt) return reply.code(400).send({ error: 'invalid_period' });
    let fromPlan = {};
    if (body.planId && body.planId !== c.planId) {
      const plan = await activePlan(c.partnerId!, body.planId);
      if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
      fromPlan = { frequencyLevel: plan.frequencyLevel, priceCents: plan.priceCents };
    }
    const [campaign] = await db
      .update(campaigns)
      .set({ ...body, ...fromPlan, updatedAt: new Date() })
      .where(and(eq(campaigns.id, c.id), ne(campaigns.status, 'cancelled')))
      .returning();
    if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
    return { campaign: withStatus(campaign) };
  });

  const lifecycle: Record<string, { from: CampaignStatus[]; to: CampaignStatus; action: ReviewAction }> = {
    pause: { from: ['active'], to: 'paused', action: 'paused' },
    resume: { from: ['paused'], to: 'active', action: 'resumed' },
    cancel: { from: ['active', 'paused'], to: 'cancelled', action: 'cancelled' },
  };
  for (const [path, change] of Object.entries(lifecycle)) {
    app.post(`/api/campaigns/:id/${path}`, partnerOnly, async (req, reply) => {
      const params = parse(IdParams, req.params, reply);
      if (!params) return reply;
      const c = await loadScopedCampaign(db, req.user!, params.id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const campaign = await transition(db, { id: c.id, ...change, actorUserId: req.user!.id });
      if (!campaign) return reply.code(409).send({ error: 'invalid_state' });
      return { campaign: withStatus(campaign) };
    });
  }

  app.patch('/api/campaigns/:id/payment', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(Payment, req.body, reply);
    if (!body) return reply;
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const campaign = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(campaigns)
        .set({ paymentStatus: body.paymentStatus, updatedAt: new Date() })
        .where(eq(campaigns.id, c.id))
        .returning();
      await logEvent(tx, { campaignId: c.id, action: 'payment', actorUserId: req.user!.id, reason: body.paymentStatus });
      return row!;
    });
    return { campaign: withStatus(campaign) };
  });

  app.post('/api/campaigns/:id/pieces', { ...anyOwner, config: uploadRateLimit(uploadLimits) }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const query = parse(MediaQuery, req.query, reply);
    if (!query) return reply;
    if (!storage || !uploadLimits) return reply.code(503).send({ error: 'storage_unavailable' });
    const c = await loadScopedCampaign(db, req.user!, params.id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (c.status === 'cancelled') return reply.code(409).send({ error: 'invalid_state' });
    const upload = await receiveUpload(req, storage, uploadLimits);
    if (!upload.ok) return reply.code(upload.status).send({ error: upload.error });
    const result = await addPiece(db, storage, c, upload, {
      // Partners publish directly; what an advertiser sends waits for the partner's approval.
      status: req.user!.role === 'advertiser' ? 'pending_review' : 'approved',
      actorUserId: req.user!.id,
      displaySeconds: query.displaySeconds,
    });
    if (typeof result !== 'string' && result.mediaType === 'video') tvOptimizer?.enqueue(result.id);
    return sendPieceResult(reply, result);
  });

  app.post('/api/campaigns/:id/pieces/:pieceId/approve', partnerOnly, async (req, reply) => {
    const target = await loadPiece(req, reply);
    if (!target) return reply;
    // The plan may have been reduced since the upload: approved pieces must still fit. The campaign row lock
    // (as in addPiece) makes two approvals racing for the last slot run one after the other.
    const result = await db.transaction(async (tx) => {
      const [c] = await tx.select({ planId: campaigns.planId }).from(campaigns).where(eq(campaigns.id, target.c.id)).for('update');
      const [p] = await tx.select({ mediaType: media.mediaType }).from(media).where(eq(media.id, target.pieceId));
      const [plan] = c?.planId ? await tx.select().from(plans).where(eq(plans.id, c.planId)) : [];
      if (plan && p) {
        const [live] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(media)
          .where(and(eq(media.campaignId, target.c.id), eq(media.mediaType, p.mediaType), eq(media.status, 'approved')));
        if ((live?.n ?? 0) >= (p.mediaType === 'video' ? plan.maxVideos : plan.maxImages)) return 'plan_limit' as const;
      }
      return changePiece(tx as unknown as Db, {
        campaignId: target.c.id, pieceId: target.pieceId, from: ['pending_review'], to: 'approved', action: 'piece_approved',
        actorUserId: req.user!.id,
      });
    });
    if (result === 'plan_limit') return reply.code(409).send({ error: 'plan_limit' });
    if (!result) return reply.code(409).send({ error: 'invalid_state' });
    return { piece: result };
  });

  app.post('/api/campaigns/:id/pieces/:pieceId/reject', partnerOnly, async (req, reply) => {
    const body = parse(Reject, req.body, reply);
    if (!body) return reply;
    const target = await loadPiece(req, reply);
    if (!target) return reply;
    const piece = await changePiece(db, {
      campaignId: target.c.id, pieceId: target.pieceId, from: ['pending_review'], to: 'rejected', action: 'piece_rejected',
      actorUserId: req.user!.id, reason: body.reason,
    });
    if (!piece) return reply.code(409).send({ error: 'invalid_state' });
    return { piece };
  });

  app.post('/api/campaigns/:id/pieces/:pieceId/remove', anyOwner, async (req, reply) => {
    const target = await loadPiece(req, reply);
    if (!target) return reply;
    const piece = await changePiece(db, {
      campaignId: target.c.id, pieceId: target.pieceId,
      // Advertisers may withdraw only what is not on air.
      from: req.user!.role === 'advertiser' ? ['pending_review', 'rejected'] : ['pending_review', 'approved', 'rejected'],
      to: 'removed', action: 'piece_removed', actorUserId: req.user!.id,
    });
    if (!piece) return reply.code(409).send({ error: 'invalid_state' });
    return { piece };
  });
};

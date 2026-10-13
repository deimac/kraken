import { and, asc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { effectiveStatus } from '../campaigns/status';
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors';
import { FREQUENCY_LEVELS, PERSON_TYPES, advertisers, campaignReviews, campaigns, plans, plays, users } from '../db/schema';
import { parse } from '../http/validation';
import { isValidDocument, onlyDigits } from './document';

const Email = z.string().trim().toLowerCase().pipe(z.email());
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const Digits = z.string().transform(onlyDigits);
const AdvertiserFields = {
  name: z.string().trim().min(1).max(120),
  personType: z.enum(PERSON_TYPES),
  document: Digits,
  legalName: text(160),
  contactName: text(120),
  email: Email.nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  whatsapp: z.string().trim().min(3).max(40).nullable().optional(),
  zip: Digits.pipe(z.string().regex(/^\d{8}$/)).nullable().optional(),
  street: text(160),
  number: text(20),
  complement: text(80),
  district: text(80),
  city: text(80),
  state: z.string().trim().toUpperCase().pipe(z.enum(UFS)).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};
const CreateAdvertiser = z.object(AdvertiserFields).strict();
const UpdateAdvertiser = z.object({ ...AdvertiserFields, document: Digits.nullable() }).partial().strict();
const ListQuery = z.object({ q: z.string().trim().max(120).optional(), archived: z.enum(['0', '1']).optional() });
const DOCUMENT_UQ = 'advertisers_partner_document_uq';

const Limit = z.number().int().min(0).max(50);
const PlanFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  frequencyLevel: z.enum(FREQUENCY_LEVELS),
  maxVideos: Limit.optional(),
  maxImages: Limit.optional(),
  maxVideoSeconds: z.number().int().min(5).max(300).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  periodMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional(),
};
// Schema defaults (1 video, 1 image) apply when a limit is omitted on create.
const validLimits = (videos: number, images: number) => videos + images > 0;
const CreatePlan = z.object(PlanFields).strict();
const UpdatePlan = z.object({ ...PlanFields, active: z.boolean() }).partial().strict();

const IdParams = z.object({ id: z.uuid() });

export const PUBLIC_PLAN = {
  id: plans.id, name: plans.name, description: plans.description, frequencyLevel: plans.frequencyLevel,
  maxVideos: plans.maxVideos, maxImages: plans.maxImages, maxVideoSeconds: plans.maxVideoSeconds,
  priceCents: plans.priceCents, periodMonths: plans.periodMonths,
};

export const catalogRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const partnerOnly = { preHandler: requireRole('partner_user') };

  const own = (id: string, partnerId: string) => and(eq(advertisers.id, id), eq(advertisers.partnerId, partnerId));
  const activeCampaigns = sql<number>`(select count(*)::int from ${campaigns} c where c.advertiser_id = "advertisers"."id"
    and "advertisers"."archived_at" is null and c.status = 'active' and c.starts_at <= now() and c.ends_at > now())`;
  const like = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

  app.get('/api/partner/advertisers', partnerOnly, async (req, reply) => {
    const query = parse(ListQuery, req.query, reply);
    if (!query) return reply;
    const filters: (SQL | undefined)[] = [
      eq(advertisers.partnerId, req.user!.partnerId!),
      query.archived === '1' ? isNotNull(advertisers.archivedAt) : isNull(advertisers.archivedAt),
    ];
    if (query.q) {
      const digits = onlyDigits(query.q);
      filters.push(
        or(
          ilike(advertisers.name, like(query.q)),
          ilike(advertisers.legalName, like(query.q)),
          ilike(advertisers.email, like(query.q)),
          digits.length >= 3 ? ilike(advertisers.document, like(digits)) : undefined,
        ),
      );
    }
    const rows = await db
      .select({ advertiser: advertisers, activeCampaigns })
      .from(advertisers)
      .where(and(...filters))
      .orderBy(asc(advertisers.name));
    return { advertisers: rows.map((r) => ({ ...r.advertiser, activeCampaigns: r.activeCampaigns })) };
  });

  app.get('/api/partner/advertisers/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const [advertiser] = await db.select().from(advertisers).where(own(params.id, req.user!.partnerId!));
    if (!advertiser) return reply.code(404).send({ error: 'not_found' });
    const list = await db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, startsAt: campaigns.startsAt, endsAt: campaigns.endsAt })
      .from(campaigns)
      .where(eq(campaigns.advertiserId, advertiser.id))
      .orderBy(asc(campaigns.startsAt));
    const monthStart = sql`date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(plays)
      .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
      .where(and(eq(campaigns.advertiserId, advertiser.id), sql`${plays.playedAt} >= ${monthStart}`));
    return {
      advertiser,
      campaigns: list.map((c) => ({ ...c, effectiveStatus: effectiveStatus(c) })),
      playsThisMonth: count?.n ?? 0,
    };
  });

  app.post('/api/partner/advertisers', partnerOnly, async (req, reply) => {
    const body = parse(CreateAdvertiser, req.body, reply);
    if (!body) return reply;
    if (!isValidDocument(body.personType, body.document)) return reply.code(400).send({ error: 'invalid_document' });
    try {
      const [advertiser] = await db
        .insert(advertisers)
        .values({ ...body, partnerId: req.user!.partnerId!, source: 'manual' })
        .returning();
      return reply.code(201).send({ advertiser });
    } catch (err) {
      if (isUniqueViolation(err, DOCUMENT_UQ)) return reply.code(409).send({ error: 'document_taken' });
      throw err;
    }
  });

  app.patch('/api/partner/advertisers/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateAdvertiser, req.body, reply);
    if (!body) return reply;
    const [current] = await db.select().from(advertisers).where(own(params.id, req.user!.partnerId!));
    if (!current) return reply.code(404).send({ error: 'not_found' });
    // Legacy rows may have no document: only validate when the document is sent or the type changes over an existing one.
    const personType = body.personType ?? current.personType;
    if (body.document !== undefined) {
      if (!body.document || !isValidDocument(personType, body.document)) return reply.code(400).send({ error: 'invalid_document' });
    } else if (personType !== current.personType && current.document && !isValidDocument(personType, current.document)) {
      return reply.code(400).send({ error: 'invalid_document' });
    }
    try {
      const [advertiser] = await db
        .update(advertisers)
        .set({ ...body, updatedAt: new Date() })
        .where(own(params.id, req.user!.partnerId!))
        .returning();
      return { advertiser };
    } catch (err) {
      if (isUniqueViolation(err, DOCUMENT_UQ)) return reply.code(409).send({ error: 'document_taken' });
      throw err;
    }
  });

  for (const action of ['archive', 'unarchive'] as const) {
    app.post(`/api/partner/advertisers/:id/${action}`, partnerOnly, async (req, reply) => {
      const params = parse(IdParams, req.params, reply);
      if (!params) return reply;
      const advertiser = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(advertisers)
          .set({ archivedAt: action === 'archive' ? new Date() : null, updatedAt: new Date() })
          .where(own(params.id, req.user!.partnerId!))
          .returning();
        if (row && action === 'archive') {
          // Archiving pauses what is on air; unarchiving never puts it back by itself.
          const paused = await tx
            .update(campaigns)
            .set({ status: 'paused', updatedAt: new Date() })
            .where(and(eq(campaigns.advertiserId, row.id), eq(campaigns.status, 'active')))
            .returning({ id: campaigns.id });
          if (paused.length) {
            await tx.insert(campaignReviews).values(
              paused.map((c) => ({ campaignId: c.id, action: 'paused' as const, actorUserId: req.user!.id, reason: 'Anunciante arquivado' })),
            );
          }
        }
        return row;
      });
      if (!advertiser) return reply.code(404).send({ error: 'not_found' });
      return { advertiser };
    });
  }

  app.delete('/api/partner/advertisers/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const [advertiser] = await db.select({ id: advertisers.id }).from(advertisers).where(own(params.id, req.user!.partnerId!));
    if (!advertiser) return reply.code(404).send({ error: 'not_found' });
    const [used] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.advertiserId, advertiser.id)).limit(1);
    if (used) return reply.code(409).send({ error: 'has_subscriptions' });
    try {
      await db.transaction(async (tx) => {
        await tx.delete(users).where(eq(users.advertiserId, advertiser.id));
        await tx.delete(advertisers).where(eq(advertisers.id, advertiser.id));
      });
    } catch (err) {
      // A campaign created between the check and the delete trips the FK (restrict): same answer as the check.
      if (isForeignKeyViolation(err)) return reply.code(409).send({ error: 'has_subscriptions' });
      throw err;
    }
    return reply.code(204).send();
  });

  app.get('/api/partner/plans', partnerOnly, async (req) => ({
    plans: await db.select().from(plans).where(eq(plans.partnerId, req.user!.partnerId!)).orderBy(asc(plans.name)),
  }));

  app.post('/api/partner/plans', partnerOnly, async (req, reply) => {
    const body = parse(CreatePlan, req.body, reply);
    if (!body) return reply;
    if (!validLimits(body.maxVideos ?? 1, body.maxImages ?? 1)) return reply.code(400).send({ error: 'invalid_limits' });
    const [plan] = await db.insert(plans).values({ ...body, partnerId: req.user!.partnerId! }).returning();
    return reply.code(201).send({ plan });
  });

  app.patch('/api/partner/plans/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePlan, req.body, reply);
    if (!body) return reply;
    const ownPlan = and(eq(plans.id, params.id), eq(plans.partnerId, req.user!.partnerId!));
    const [current] = await db.select().from(plans).where(ownPlan);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    if (!validLimits(body.maxVideos ?? current.maxVideos, body.maxImages ?? current.maxImages)) {
      return reply.code(400).send({ error: 'invalid_limits' });
    }
    const [plan] = await db.update(plans).set({ ...body, updatedAt: new Date() }).where(ownPlan).returning();
    return { plan };
  });

  for (const action of ['archive', 'unarchive'] as const) {
    app.post(`/api/partner/plans/:id/${action}`, partnerOnly, async (req, reply) => {
      const params = parse(IdParams, req.params, reply);
      if (!params) return reply;
      const [plan] = await db
        .update(plans)
        .set({ active: action === 'unarchive', updatedAt: new Date() })
        .where(and(eq(plans.id, params.id), eq(plans.partnerId, req.user!.partnerId!)))
        .returning();
      if (!plan) return reply.code(404).send({ error: 'not_found' });
      return { plan };
    });
  }

  app.get('/api/advertiser/plans', { preHandler: requireRole('advertiser') }, async (req) => ({
    plans: await db
      .select(PUBLIC_PLAN)
      .from(plans)
      .where(and(eq(plans.partnerId, req.user!.partnerId!), eq(plans.active, true)))
      .orderBy(asc(plans.name)),
  }));

  app.get('/api/advertiser', { preHandler: requireRole('advertiser') }, async (req) => {
    const [advertiser] = await db.select().from(advertisers).where(eq(advertisers.id, req.user!.advertiserId!));
    return { advertiser };
  });
};

import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { FREQUENCY_LEVELS, advertisers, plans } from '../db/schema';
import { parse } from '../http/validation';

const Email = z.string().trim().toLowerCase().pipe(z.email());
const AdvertiserFields = {
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(120).nullable().optional(),
  email: Email.nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
};
const CreateAdvertiser = z.object(AdvertiserFields).strict();
const UpdateAdvertiser = z.object(AdvertiserFields).partial().strict();

const PlanFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  frequencyLevel: z.enum(FREQUENCY_LEVELS),
};
const CreatePlan = z.object(PlanFields).strict();
const UpdatePlan = z.object({ ...PlanFields, active: z.boolean() }).partial().strict();

const IdParams = z.object({ id: z.uuid() });

export const catalogRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const partnerOnly = { preHandler: requireRole('partner_user') };

  app.get('/api/partner/advertisers', partnerOnly, async (req) => ({
    advertisers: await db
      .select()
      .from(advertisers)
      .where(eq(advertisers.partnerId, req.user!.partnerId!))
      .orderBy(asc(advertisers.name)),
  }));

  app.post('/api/partner/advertisers', partnerOnly, async (req, reply) => {
    const body = parse(CreateAdvertiser, req.body, reply);
    if (!body) return reply;
    const [advertiser] = await db
      .insert(advertisers)
      .values({ ...body, partnerId: req.user!.partnerId!, source: 'manual' })
      .returning();
    return reply.code(201).send({ advertiser });
  });

  app.patch('/api/partner/advertisers/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdateAdvertiser, req.body, reply);
    if (!body) return reply;
    const [advertiser] = await db
      .update(advertisers)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(advertisers.id, params.id), eq(advertisers.partnerId, req.user!.partnerId!)))
      .returning();
    if (!advertiser) return reply.code(404).send({ error: 'not_found' });
    return { advertiser };
  });

  app.get('/api/partner/plans', partnerOnly, async (req) => ({
    plans: await db.select().from(plans).where(eq(plans.partnerId, req.user!.partnerId!)).orderBy(asc(plans.name)),
  }));

  app.post('/api/partner/plans', partnerOnly, async (req, reply) => {
    const body = parse(CreatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db.insert(plans).values({ ...body, partnerId: req.user!.partnerId! }).returning();
    return reply.code(201).send({ plan });
  });

  app.patch('/api/partner/plans/:id', partnerOnly, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db
      .update(plans)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(plans.id, params.id), eq(plans.partnerId, req.user!.partnerId!)))
      .returning();
    if (!plan) return reply.code(404).send({ error: 'not_found' });
    return { plan };
  });

  app.get('/api/advertiser', { preHandler: requireRole('advertiser') }, async (req) => {
    const [advertiser] = await db.select().from(advertisers).where(eq(advertisers.id, req.user!.advertiserId!));
    return { advertiser };
  });
};

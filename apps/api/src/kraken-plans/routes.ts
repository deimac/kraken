import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { krakenPlans } from '../db/schema';
import { parse } from '../http/validation';

const Fields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
};
const CreatePlan = z
  .object({ name: Fields.name, description: Fields.description.optional(), priceCents: Fields.priceCents.optional() })
  .strict();
const UpdatePlan = z.object({ ...Fields, active: z.boolean() }).partial().strict();
const IdParams = z.object({ id: z.uuid() });

// Plans Kraken Ads sells to partners (spec D8): catalog only, no billing or limits.
export const krakenPlanRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/api/admin/kraken-plans', async () => ({
    plans: await db.select().from(krakenPlans).orderBy(asc(krakenPlans.name)),
  }));

  app.post('/api/admin/kraken-plans', async (req, reply) => {
    const body = parse(CreatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db.insert(krakenPlans).values(body).returning();
    return reply.code(201).send({ plan });
  });

  app.patch('/api/admin/kraken-plans/:id', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db
      .update(krakenPlans)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(krakenPlans.id, params.id))
      .returning();
    if (!plan) return reply.code(404).send({ error: 'not_found' });
    return { plan };
  });
};

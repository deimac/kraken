import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { hashPassword } from '../auth/password';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { partners, users } from '../db/schema';
import { parse } from '../http/validation';

const Slug = z.string().max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Weight = z.number().int().min(1).max(100);

const CreatePartner = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: Slug,
    showInstitutional: z.boolean().optional(),
  })
  .strict();

const UpdatePartner = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    showInstitutional: z.boolean().optional(),
    weightLow: Weight.optional(),
    weightMedium: Weight.optional(),
    weightHigh: Weight.optional(),
    defaultImageSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .strict();

const CreateUser = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8).max(200),
  })
  .strict();

const IdParams = z.object({ id: z.uuid() });

export const adminPartnerRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/api/admin/partners', async () => ({
    partners: await db.select().from(partners).orderBy(asc(partners.name)),
  }));

  app.post('/api/admin/partners', async (req, reply) => {
    const body = parse(CreatePartner, req.body, reply);
    if (!body) return reply;
    try {
      const [partner] = await db.insert(partners).values(body).returning();
      return reply.code(201).send({ partner });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'slug_taken' });
      throw err;
    }
  });

  app.patch('/api/admin/partners/:id', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePartner, req.body, reply);
    if (!body) return reply;
    const [partner] = await db
      .update(partners)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(partners.id, params.id))
      .returning();
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    return { partner };
  });

  app.post('/api/admin/partners/:id/users', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(CreateUser, req.body, reply);
    if (!body) return reply;
    const [partner] = await db.select({ id: partners.id }).from(partners).where(eq(partners.id, params.id));
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    try {
      const [user] = await db
        .insert(users)
        .values({
          email: body.email,
          passwordHash: await hashPassword(body.password),
          role: 'partner_user',
          partnerId: partner.id,
        })
        .returning({ id: users.id, email: users.email, role: users.role, partnerId: users.partnerId });
      return reply.code(201).send({ user });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'email_taken' });
      throw err;
    }
  });
};

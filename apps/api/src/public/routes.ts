import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { setSessionCookie } from '../auth/plugin';
import { createSession } from '../auth/sessions';
import type { Db } from '../db/client';
import { isUniqueViolation } from '../db/errors';
import { isValidDocument, onlyDigits } from '../catalog/document';
import { PUBLIC_PLAN } from '../catalog/routes';
import { PERSON_TYPES, advertisers, partners, plans, users } from '../db/schema';
import { parse } from '../http/validation';

const SlugParams = z.object({ slug: z.string().max(60) });
const Signup = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    contactName: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: z.string().trim().min(3).max(40).optional(),
    personType: z.enum(PERSON_TYPES),
    document: z.string().transform(onlyDigits),
    password: z.string().min(8).max(200),
  })
  .strict();

export const publicRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean }> = async (
  app,
  { db, cookieSecure },
) => {
  const activePartner = async (slug: string) => {
    const [p] = await db
      .select({ id: partners.id, name: partners.name, slug: partners.slug })
      .from(partners)
      .where(and(eq(partners.slug, slug), eq(partners.status, 'active')));
    return p;
  };

  app.get('/api/public/partners/:slug', async (req, reply) => {
    const params = parse(SlugParams, req.params, reply);
    if (!params) return reply;
    const partner = await activePartner(params.slug);
    if (!partner) return reply.code(404).send({ error: 'not_found' });
    const list = await db
      .select(PUBLIC_PLAN)
      .from(plans)
      .where(and(eq(plans.partnerId, partner.id), eq(plans.active, true)))
      .orderBy(asc(plans.name));
    return { partner: { name: partner.name, slug: partner.slug }, plans: list };
  });

  app.post(
    '/api/public/partners/:slug/advertisers',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const params = parse(SlugParams, req.params, reply);
      if (!params) return reply;
      const body = parse(Signup, req.body, reply);
      if (!body) return reply;
      if (!isValidDocument(body.personType, body.document)) return reply.code(400).send({ error: 'invalid_document' });
      const partner = await activePartner(params.slug);
      if (!partner) return reply.code(404).send({ error: 'not_found' });
      const passwordHash = await hashPassword(body.password);
      try {
        const user = await db.transaction(async (tx) => {
          const [advertiser] = await tx
            .insert(advertisers)
            .values({
              partnerId: partner.id,
              name: body.companyName,
              contactName: body.contactName,
              email: body.email,
              phone: body.phone ?? null,
              personType: body.personType,
              document: body.document,
              source: 'self_signup',
            })
            .returning();
          const [created] = await tx
            .insert(users)
            .values({ email: body.email, passwordHash, role: 'advertiser', partnerId: partner.id, advertiserId: advertiser!.id })
            .returning({ id: users.id, email: users.email, role: users.role, partnerId: users.partnerId, advertiserId: users.advertiserId });
          return created!;
        });
        const { token, expiresAt } = await createSession(db, user);
        setSessionCookie(reply, token, expiresAt, cookieSecure);
        return reply.code(201).send({ user });
      } catch (err) {
        if (isUniqueViolation(err, 'advertisers_partner_document_uq')) return reply.code(409).send({ error: 'document_taken' });
        if (isUniqueViolation(err)) return reply.code(409).send({ error: 'email_taken' });
        throw err;
      }
    },
  );
};

import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { hashPassword } from '../auth/password';
import { deleteUserSessions } from '../auth/sessions';
import type { Db } from '../db/client';
import { partners, users } from '../db/schema';
import { parse } from '../http/validation';

const PlayerAccount = z.object({ password: z.string().min(8).max(200) }).strict();

// partnerId always comes from the session, never from the request.
export const partnerRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('partner_user'));

  app.get('/api/partner', async (req) => {
    const [partner] = await db.select().from(partners).where(eq(partners.id, req.user!.partnerId!));
    return { partner };
  });

  app.get('/api/partner/users', async (req) => ({
    users: await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.partnerId, req.user!.partnerId!))
      .orderBy(asc(users.email)),
  }));

  app.put('/api/partner/player-account', async (req, reply) => {
    const body = parse(PlayerAccount, req.body, reply);
    if (!body) return reply;
    const partnerId = req.user!.partnerId!;
    const [partner] = await db.select({ slug: partners.slug }).from(partners).where(eq(partners.id, partnerId));
    const loginName = `tv@${partner!.slug}`;
    const passwordHash = await hashPassword(body.password);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.partnerId, partnerId), eq(users.role, 'player')));
    if (existing) {
      await db.update(users).set({ passwordHash, email: loginName, updatedAt: new Date() }).where(eq(users.id, existing.id));
      await deleteUserSessions(db, existing.id);
    } else {
      await db.insert(users).values({ email: loginName, passwordHash, role: 'player', partnerId });
    }
    return { login: loginName };
  });
};

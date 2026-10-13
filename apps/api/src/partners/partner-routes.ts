import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { hashPassword } from '../auth/password';
import { deleteUserSessions } from '../auth/sessions';
import type { Db } from '../db/client';
import { partners, users } from '../db/schema';
import { parse } from '../http/validation';
import { generateTvCode, hashTvCode } from '../player/code';

const PlayerAccount = z.object({ password: z.string().min(8).max(200) }).strict();
const Settings = z
  .object({ transition: z.enum(['fade', 'slide', 'cut']), transitionMs: z.number().int().min(0).max(3000) })
  .partial()
  .strict();

// partnerId always comes from the session, never from the request.
export const partnerRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('partner_user'));

  app.get('/api/partner', async (req) => {
    const [row] = await db.select().from(partners).where(eq(partners.id, req.user!.partnerId!));
    const { tvCodeHash, ...partner } = row!;
    return { partner: { ...partner, tvCodeSet: tvCodeHash !== null } };
  });

  /** New TV access code (replaces the previous one; TVs already signed in stay signed in). Shown once. */
  app.post('/api/partner/player-code', async (req) => {
    const partnerId = req.user!.partnerId!;
    const code = generateTvCode();
    await db.transaction(async (tx) => {
      const [player] = await tx.select({ id: users.id }).from(users).where(and(eq(users.partnerId, partnerId), eq(users.role, 'player')));
      if (!player) {
        const [p] = await tx.select({ slug: partners.slug }).from(partners).where(eq(partners.id, partnerId));
        // Random password nobody knows: the TV signs in with the code; the partner can still set one later.
        const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
        await tx.insert(users).values({ email: `tv@${p!.slug}`, passwordHash, role: 'player', partnerId });
      }
      await tx.update(partners).set({ tvCodeHash: hashTvCode(code), updatedAt: new Date() }).where(eq(partners.id, partnerId));
    });
    return { code, path: `/player/#${code}` };
  });

  app.get('/api/partner/users', async (req) => ({
    users: await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.partnerId, req.user!.partnerId!))
      .orderBy(asc(users.email)),
  }));

  app.patch('/api/partner/settings', async (req, reply) => {
    const body = parse(Settings, req.body, reply);
    if (!body) return reply;
    const [partner] = await db
      .update(partners)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(partners.id, req.user!.partnerId!))
      .returning();
    return { partner };
  });

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

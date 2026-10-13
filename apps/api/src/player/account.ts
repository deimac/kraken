import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import type { Db } from '../db/client';
import { partners, users } from '../db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The partner's TV user (one per partner), created on first need with a random password nobody knows. */
export async function ensurePlayerUser(db: Db | Tx, partnerId: string) {
  const find = () =>
    db
      .select({ id: users.id, email: users.email, role: users.role, partnerId: users.partnerId, advertiserId: users.advertiserId })
      .from(users)
      .where(and(eq(users.partnerId, partnerId), eq(users.role, 'player')));
  const [existing] = await find();
  if (existing) return existing;
  const [p] = await db.select({ slug: partners.slug }).from(partners).where(eq(partners.id, partnerId));
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
  // Two first-time requests at once must not fail on the unique login name.
  await db.insert(users).values({ email: `tv@${p!.slug}`, passwordHash, role: 'player', partnerId }).onConflictDoNothing();
  return (await find())[0]!;
}

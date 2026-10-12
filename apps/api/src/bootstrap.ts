import { eq } from 'drizzle-orm';
import { hashPassword } from './auth/password';
import type { Db } from './db/client';
import { users } from './db/schema';

export async function ensureAdmin(
  db: Db,
  { email, password }: { email: string; password: string },
): Promise<'created' | 'exists'> {
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters');
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized));
  if (existing) return 'exists';
  await db.insert(users).values({ email: normalized, passwordHash: await hashPassword(password), role: 'admin' });
  return 'created';
}

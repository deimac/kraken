import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password';
import { ensureAdmin } from '../src/bootstrap';
import type { Db } from '../src/db/client';
import { users } from '../src/db/schema';
import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

it('creates the admin once and never overwrites its password', async () => {
  expect(await ensureAdmin(db, { email: ' Admin@Midora.com ', password: 'primeira-senha-1' })).toBe('created');
  expect(await ensureAdmin(db, { email: 'admin@midora.com', password: 'outra-senha-123' })).toBe('exists');
  const [u] = await db.select().from(users).where(eq(users.email, 'admin@midora.com'));
  expect(u!.role).toBe('admin');
  expect(await verifyPassword(u!.passwordHash, 'primeira-senha-1')).toBe(true);
});

it('refuses passwords shorter than 12 characters', async () => {
  await expect(ensureAdmin(db, { email: 'x@midora.com', password: 'curta' })).rejects.toThrow(
    'ADMIN_PASSWORD must have at least 12 characters',
  );
});

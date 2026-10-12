import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { isUniqueViolation } from '../src/db/errors';
import { partners, users } from '../src/db/schema';
import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
let partnerId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [p] = await db.insert(partners).values({ name: 'A', slug: 'a' }).returning();
  partnerId = p!.id;
});
afterAll(() => close());

it('applies partner defaults', async () => {
  const [p] = await db.insert(partners).values({ name: 'B', slug: 'b' }).returning();
  expect(p).toMatchObject({
    status: 'active', weightLow: 1, weightMedium: 2, weightHigh: 3,
    defaultImageSeconds: 10, showInstitutional: false,
  });
});

it('rejects duplicate slug as unique violation', async () => {
  const err = await db.insert(partners).values({ name: 'A2', slug: 'a' }).catch((e) => e);
  expect(isUniqueViolation(err)).toBe(true);
});

it('rejects admin with a partner and partner_user without one', async () => {
  await expect(
    db.insert(users).values({ email: 'x@x.com', passwordHash: 'h', role: 'admin', partnerId }),
  ).rejects.toThrow();
  await expect(
    db.insert(users).values({ email: 'y@x.com', passwordHash: 'h', role: 'partner_user' }),
  ).rejects.toThrow();
});

it('allows only one player per partner', async () => {
  await db.insert(users).values({ email: 'tv@a', passwordHash: 'h', role: 'player', partnerId });
  const err = await db
    .insert(users)
    .values({ email: 'tv2@a', passwordHash: 'h', role: 'player', partnerId })
    .catch((e) => e);
  expect(isUniqueViolation(err)).toBe(true);
});

it('rejects non-positive weights', async () => {
  await expect(
    db.insert(partners).values({ name: 'C', slug: 'c', weightHigh: 0 }),
  ).rejects.toThrow();
});

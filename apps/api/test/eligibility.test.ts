import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listEligible } from '../src/campaigns/eligibility';
import type { Db } from '../src/db/client';
import { advertisers, campaigns, media, partners, plans } from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { createPartner } from './helpers/fixtures';

let db: Db;
let close: () => Promise<void>;
const now = new Date('2026-06-15T12:00:00Z');

async function makeCampaign(opts: {
  partnerId: string | null; status: 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'cancelled';
  startsAt?: string; endsAt?: string; withMedia?: boolean; name: string;
}) {
  let advertiserId: string | null = null;
  let planId: string | null = null;
  if (opts.partnerId) {
    advertiserId = (await db.insert(advertisers).values({ partnerId: opts.partnerId, name: 'A', source: 'manual' }).returning())[0]!.id;
    planId = (await db.insert(plans).values({ partnerId: opts.partnerId, name: 'P', frequencyLevel: 'medium' }).returning())[0]!.id;
  }
  const [c] = await db.insert(campaigns).values({
    kind: opts.partnerId ? 'commercial' : 'institutional', partnerId: opts.partnerId, advertiserId, planId, name: opts.name,
    status: opts.status, frequencyLevel: 'medium',
    startsAt: new Date(opts.startsAt ?? '2026-06-01T00:00:00Z'), endsAt: new Date(opts.endsAt ?? '2026-07-01T00:00:00Z'),
  }).returning();
  if (opts.withMedia ?? true) {
    const [m] = await db.insert(media).values({
      partnerId: opts.partnerId, campaignId: c!.id, storageKey: `k/${c!.id}`, mediaType: 'video', mime: 'video/mp4',
      sizeBytes: 100, durationMs: 15000, sha256: 'abc', displaySeconds: null,
    }).returning();
    await db.update(campaigns).set({ currentMediaId: m!.id }).where(eq(campaigns.id, c!.id));
  }
  return c!;
}

let pA: string;
let pB: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  pA = (await createPartner(db, 'a')).id;
  pB = (await createPartner(db, 'b')).id;
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'ok' });
  await makeCampaign({ partnerId: pA, status: 'draft', name: 'draft' });
  await makeCampaign({ partnerId: pA, status: 'pending_review', name: 'pending' });
  await makeCampaign({ partnerId: pA, status: 'changes_requested', name: 'changes' });
  await makeCampaign({ partnerId: pA, status: 'cancelled', name: 'cancelled' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'future', startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-08-01T00:00:00Z' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'past', startsAt: '2026-05-01T00:00:00Z', endsAt: '2026-06-15T12:00:00Z' });
  await makeCampaign({ partnerId: pA, status: 'approved', name: 'nomedia', withMedia: false });
  await makeCampaign({ partnerId: pB, status: 'approved', name: 'other-partner' });
  await makeCampaign({ partnerId: null, status: 'approved', name: 'institutional' });
});
afterAll(() => close());

describe('listEligible', () => {
  it('returns only approved, in-period campaigns with media of the partner', async () => {
    const items = await listEligible(db, pA, now);
    expect(items.map((i) => i.name)).toEqual(['ok']);
    expect(items[0]).toMatchObject({ kind: 'commercial', frequencyLevel: 'medium', media: { mediaType: 'video', durationMs: 15000 } });
  });

  it('adds institutional campaigns only when the partner allows them', async () => {
    await db.update(partners).set({ showInstitutional: true }).where(eq(partners.id, pA));
    expect((await listEligible(db, pA, now)).map((i) => i.name).sort()).toEqual(['institutional', 'ok']);
    expect((await listEligible(db, pB, now)).map((i) => i.name)).toEqual(['other-partner']);
  });

  it('returns nothing for inactive partners', async () => {
    await db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, pB));
    expect(await listEligible(db, pB, now)).toEqual([]);
  });

  it('skips campaigns of archived advertisers', async () => {
    const pC = (await createPartner(db, 'c')).id;
    const c = await makeCampaign({ partnerId: pC, status: 'approved', name: 'archived-adv' });
    expect((await listEligible(db, pC, now)).map((i) => i.name)).toEqual(['archived-adv']);
    await db.update(advertisers).set({ archivedAt: now }).where(eq(advertisers.id, c.advertiserId!));
    expect(await listEligible(db, pC, now)).toEqual([]);
  });
});

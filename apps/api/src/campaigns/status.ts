import type { CampaignStatus } from '../db/schema';

export type EffectiveStatus = Exclude<CampaignStatus, 'active'> | 'scheduled' | 'active' | 'ended';

/** An active subscription is on air only inside its period. */
export function effectiveStatus(
  c: { status: CampaignStatus; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EffectiveStatus {
  if (c.status !== 'active') return c.status;
  if (now < c.startsAt) return 'scheduled';
  if (now >= c.endsAt) return 'ended';
  return 'active';
}

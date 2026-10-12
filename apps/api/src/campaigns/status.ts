import type { CampaignStatus } from '../db/schema';

export type EffectiveStatus = CampaignStatus | 'scheduled' | 'active' | 'ended';

export function effectiveStatus(
  c: { status: CampaignStatus; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EffectiveStatus {
  if (c.status !== 'approved') return c.status;
  if (now < c.startsAt) return 'scheduled';
  if (now >= c.endsAt) return 'ended';
  return 'active';
}

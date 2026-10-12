import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { advertisers, campaigns, media, partners, type FrequencyLevel } from '../db/schema';

export interface EligibleItem {
  campaignId: string;
  kind: 'commercial' | 'institutional';
  name: string;
  frequencyLevel: FrequencyLevel;
  media: {
    id: string;
    mediaType: 'image' | 'video';
    mime: string;
    sha256: string;
    sizeBytes: number;
    durationMs: number | null;
    displaySeconds: number | null;
  };
}

/** Campaigns a partner's TVs may play right now (spec §8). */
export async function listEligible(db: Db, partnerId: string, now: Date = new Date()): Promise<EligibleItem[]> {
  const [partner] = await db
    .select({ status: partners.status, showInstitutional: partners.showInstitutional })
    .from(partners)
    .where(eq(partners.id, partnerId));
  if (!partner || partner.status !== 'active') return [];
  const owner = partner.showInstitutional
    ? or(eq(campaigns.partnerId, partnerId), eq(campaigns.kind, 'institutional'))
    : eq(campaigns.partnerId, partnerId);
  const rows = await db
    .select({
      campaignId: campaigns.id, kind: campaigns.kind, name: campaigns.name, frequencyLevel: campaigns.frequencyLevel,
      mediaId: media.id, mediaType: media.mediaType, mime: media.mime, sha256: media.sha256,
      sizeBytes: media.sizeBytes, durationMs: media.durationMs, displaySeconds: media.displaySeconds,
    })
    .from(campaigns)
    .innerJoin(media, eq(media.id, campaigns.currentMediaId))
    .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
    .where(and(owner, isNull(advertisers.archivedAt), eq(campaigns.status, 'approved'), lte(campaigns.startsAt, now), gt(campaigns.endsAt, now)))
    .orderBy(asc(campaigns.createdAt), asc(campaigns.id));
  return rows.map((r) => ({
    campaignId: r.campaignId, kind: r.kind, name: r.name, frequencyLevel: r.frequencyLevel,
    media: {
      id: r.mediaId, mediaType: r.mediaType, mime: r.mime, sha256: r.sha256, sizeBytes: r.sizeBytes,
      durationMs: r.durationMs, displaySeconds: r.displaySeconds,
    },
  }));
}

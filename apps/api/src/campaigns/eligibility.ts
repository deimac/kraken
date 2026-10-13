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
    /** TV-optimized copy and poster, once ready (see media/tv-optimize.ts). */
    tvReady: boolean;
    /** Changes whenever the TV copy is re-made (part of its URL, so caches never serve an old one). */
    tvVersion: string | null;
    posterReady: boolean;
  };
}

/** Pieces a partner's TVs may play right now: one item per approved piece of each subscription on air. */
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
      tvKey: media.tvKey, posterKey: media.posterKey,
    })
    .from(campaigns)
    .innerJoin(media, and(eq(media.campaignId, campaigns.id), eq(media.status, 'approved')))
    .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
    .where(and(owner, isNull(advertisers.archivedAt), eq(campaigns.status, 'active'), lte(campaigns.startsAt, now), gt(campaigns.endsAt, now)))
    .orderBy(asc(campaigns.createdAt), asc(campaigns.id), asc(media.createdAt), asc(media.id));
  return rows.map((r) => ({
    campaignId: r.campaignId, kind: r.kind, name: r.name, frequencyLevel: r.frequencyLevel,
    media: {
      id: r.mediaId, mediaType: r.mediaType, mime: r.mime, sha256: r.sha256, sizeBytes: r.sizeBytes,
      durationMs: r.durationMs, displaySeconds: r.displaySeconds,
      tvReady: r.tvKey !== null, tvVersion: r.tvKey?.split('.').at(-2) ?? null, posterReady: r.posterKey !== null,
    },
  }));
}

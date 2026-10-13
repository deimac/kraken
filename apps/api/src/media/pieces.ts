import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { campaignReviews, campaigns, media, partners, plans, type PieceStatus } from '../db/schema';
import type { LocalStorage } from '../storage/local';
import type { UploadOk } from './upload';

type Campaign = typeof campaigns.$inferSelect;
export type Media = typeof media.$inferSelect;

/** Containers report a few ms over the nominal length: a "15 s" video must fit a 15 s plan. */
const DURATION_TOLERANCE_MS = 500;

export type AddPieceResult = Media | 'invalid_state' | 'plan_limit' | 'video_too_long' | 'invalid_display_seconds';

/** Pieces counting against the plan: live ones and those waiting for approval. */
export const OCCUPYING: PieceStatus[] = ['approved', 'pending_review'];

/**
 * Stores an uploaded file as a new piece of the subscription. The plan limits are checked under a row lock on the
 * campaign, so two uploads racing for the last slot cannot both get in. Institutional campaigns have no plan.
 */
export async function addPiece(
  db: Db,
  storage: LocalStorage,
  campaign: Campaign,
  upload: UploadOk,
  opts: { status: 'approved' | 'pending_review'; actorUserId: string; displaySeconds?: string },
): Promise<AddPieceResult> {
  let displaySeconds: number | null = null;
  if (upload.mediaType === 'image') {
    if (opts.displaySeconds !== undefined) {
      const n = Number(opts.displaySeconds);
      if (!Number.isInteger(n) || n < 1 || n > 3600) {
        await rm(upload.tmpPath, { force: true });
        return 'invalid_display_seconds';
      }
      displaySeconds = n;
    } else if (campaign.partnerId) {
      const [p] = await db.select({ s: partners.defaultImageSeconds }).from(partners).where(eq(partners.id, campaign.partnerId));
      displaySeconds = p?.s ?? 10;
    } else {
      displaySeconds = 10;
    }
  }

  const id = randomUUID();
  const key = `${campaign.partnerId ?? 'institutional'}/${id}.${upload.ext}`;
  await storage.saveFrom(upload.tmpPath, key);
  try {
    const result = await db.transaction(async (tx): Promise<AddPieceResult> => {
      const [current] = await tx
        .select({ id: campaigns.id, planId: campaigns.planId })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaign.id), inArray(campaigns.status, ['active', 'paused'])))
        .for('update');
      if (!current) return 'invalid_state';
      if (current.planId) {
        const [plan] = await tx.select().from(plans).where(eq(plans.id, current.planId));
        if (plan) {
          if (upload.mediaType === 'video' && (upload.durationMs ?? 0) > plan.maxVideoSeconds * 1000 + DURATION_TOLERANCE_MS) {
            return 'video_too_long';
          }
          const [used] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(media)
            .where(and(eq(media.campaignId, campaign.id), eq(media.mediaType, upload.mediaType), inArray(media.status, OCCUPYING)));
          const limit = upload.mediaType === 'video' ? plan.maxVideos : plan.maxImages;
          if ((used?.n ?? 0) >= limit) return 'plan_limit';
        }
      }
      const [row] = await tx
        .insert(media)
        .values({
          id, partnerId: campaign.partnerId, campaignId: campaign.id, storageKey: key, mediaType: upload.mediaType,
          mime: upload.mime, sizeBytes: upload.sizeBytes, durationMs: upload.durationMs, sha256: upload.sha256, displaySeconds,
          status: opts.status, uploadedBy: opts.actorUserId, originalName: upload.originalName,
        })
        .returning();
      await tx.insert(campaignReviews).values({
        campaignId: campaign.id, mediaId: id, actorUserId: opts.actorUserId,
        action: opts.status === 'approved' ? 'piece_added' : 'piece_submitted',
      });
      await tx.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      return row!;
    });
    if (typeof result === 'string') await storage.remove(key);
    return result;
  } catch (err) {
    await storage.remove(key);
    throw err;
  }
}

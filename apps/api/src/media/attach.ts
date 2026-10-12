import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { campaigns, media, partners, type CampaignStatus } from '../db/schema';
import type { LocalStorage } from '../storage/local';
import type { UploadOk } from './upload';

type Campaign = typeof campaigns.$inferSelect;
export type Media = typeof media.$inferSelect;

/** Stores the uploaded file, records it and makes it the campaign's current media. */
export async function attachMedia(
  db: Db,
  storage: LocalStorage,
  campaign: Campaign,
  upload: UploadOk,
  { allowedStatuses }: { allowedStatuses: CampaignStatus[] },
): Promise<Media | undefined | 'invalid_display_seconds'> {
  let displaySeconds: number | null = null;
  if (upload.mediaType === 'image') {
    if (upload.fields.displaySeconds !== undefined) {
      const n = Number(upload.fields.displaySeconds);
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
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaign.id), inArray(campaigns.status, allowedStatuses)))
        .for('update');
      if (!current) throw new Error('state_changed');
      const [row] = await tx
        .insert(media)
        .values({
          id, partnerId: campaign.partnerId, campaignId: campaign.id, storageKey: key, mediaType: upload.mediaType,
          mime: upload.mime, sizeBytes: upload.sizeBytes, durationMs: upload.durationMs, sha256: upload.sha256, displaySeconds,
        })
        .returning();
      await tx.update(campaigns).set({ currentMediaId: id, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      return row;
    });
  } catch (err) {
    await storage.remove(key);
    if ((err as Error).message === 'state_changed') return undefined;
    throw err;
  }
}

import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { advertisers, campaigns, media, plays } from '../db/schema';

export type ReportScope =
  | { kind: 'all' }
  | { kind: 'partner'; partnerId: string }
  | { kind: 'advertiser'; advertiserId: string };

export interface ReportRow {
  campaignId: string;
  name: string;
  kind: 'commercial' | 'institutional';
  advertiserName: string | null;
  total: number;
  days: { day: string; count: number }[];
  pieces: { mediaId: string; label: string; mediaType: 'image' | 'video'; total: number }[];
}

/** One line per subscription, piece and day (the CSV export). */
export interface ReportLine {
  campaignId: string; name: string; kind: 'commercial' | 'institutional'; advertiserName: string | null;
  piece: string; day: string; count: number;
}

const pieceLabel = (m: { originalName: string | null; mediaType: 'image' | 'video' }) =>
  m.originalName ?? (m.mediaType === 'video' ? 'Vídeo' : 'Imagem');

/** Reports use Brasília time (spec D11), which has had no DST since 2019: a fixed -03:00 bounds days exactly. */
function bounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(`${to}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function playsReport(
  db: Db,
  scope: ReportScope,
  range: { from: string; to: string },
): Promise<{ campaigns: ReportRow[]; lines: ReportLine[] }> {
  const { start, end } = bounds(range.from, range.to);
  const day = sql<string>`to_char(${plays.playedAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
  const filters: SQL[] = [gte(plays.playedAt, start), lt(plays.playedAt, end)];
  if (scope.kind === 'partner') filters.push(eq(plays.partnerId, scope.partnerId));
  if (scope.kind === 'advertiser') filters.push(eq(campaigns.advertiserId, scope.advertiserId));

  const rows = await db
    .select({
      campaignId: campaigns.id,
      name: campaigns.name,
      kind: campaigns.kind,
      advertiserName: advertisers.name,
      mediaId: media.id,
      originalName: media.originalName,
      mediaType: media.mediaType,
      day,
      count: sql<number>`count(*)::int`,
    })
    .from(plays)
    .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
    .innerJoin(media, eq(media.id, plays.mediaId))
    .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
    .where(and(...filters))
    .groupBy(campaigns.id, campaigns.name, campaigns.kind, advertisers.name, media.id, media.originalName, media.mediaType, day)
    .orderBy(asc(campaigns.name), asc(day), asc(media.originalName));

  const out = new Map<string, ReportRow>();
  const lines: ReportLine[] = [];
  for (const r of rows) {
    let row = out.get(r.campaignId);
    if (!row) {
      row = { campaignId: r.campaignId, name: r.name, kind: r.kind, advertiserName: r.advertiserName, total: 0, days: [], pieces: [] };
      out.set(r.campaignId, row);
    }
    row.total += r.count;
    const d = row.days.find((x) => x.day === r.day);
    if (d) d.count += r.count;
    else row.days.push({ day: r.day, count: r.count });
    const label = pieceLabel(r);
    const p = row.pieces.find((x) => x.mediaId === r.mediaId);
    if (p) p.total += r.count;
    else row.pieces.push({ mediaId: r.mediaId, label, mediaType: r.mediaType, total: r.count });
    lines.push({ campaignId: r.campaignId, name: r.name, kind: r.kind, advertiserName: r.advertiserName, piece: label, day: r.day, count: r.count });
  }
  for (const row of out.values()) row.pieces.sort((a, b) => a.label.localeCompare(b.label));
  return { campaigns: [...out.values()], lines };
}

import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { advertisers, campaigns, plays } from '../db/schema';

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
}

/** Reports use Brasília time (spec D11), which has had no DST since 2019: a fixed -03:00 bounds days exactly. */
function bounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(`${to}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function playsReport(db: Db, scope: ReportScope, range: { from: string; to: string }): Promise<ReportRow[]> {
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
      day,
      count: sql<number>`count(*)::int`,
    })
    .from(plays)
    .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
    .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
    .where(and(...filters))
    .groupBy(campaigns.id, campaigns.name, campaigns.kind, advertisers.name, day)
    .orderBy(asc(campaigns.name), asc(day));

  const out = new Map<string, ReportRow>();
  for (const r of rows) {
    let row = out.get(r.campaignId);
    if (!row) {
      row = { campaignId: r.campaignId, name: r.name, kind: r.kind, advertiserName: r.advertiserName, total: 0, days: [] };
      out.set(r.campaignId, row);
    }
    row.total += r.count;
    row.days.push({ day: r.day, count: r.count });
  }
  return [...out.values()];
}

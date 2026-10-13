import { and, asc, eq, gt, gte, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { advertisers, campaigns, media, partners, plays, users } from '../db/schema';

const DAY_MS = 86_400_000;
const SERIES_DAYS = 14;
/** The TV asks for its list every 5 minutes: allow one missed poll before calling it offline. */
const ONLINE_MS = 15 * 60_000;

/** Brasília calendar day (no DST since 2019: fixed -03:00, as in reports). */
const brDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
/** Start of the Brasília day `daysAgo` days before the day of `now`. */
const dayStart = (now: number, daysAgo: number) => new Date(new Date(`${brDay(now)}T00:00:00-03:00`).getTime() - daysAgo * DAY_MS);
const monthStart = (now: number) => new Date(`${brDay(now).slice(0, 7)}-01T00:00:00-03:00`);

const n = sql<number>`count(*)::int`;

/** Home screen numbers for each role: what is on air, what needs attention, and plays per Brasília day. */
export const dashboardRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  /** Commercial subscriptions the TVs are actually playing (same rules as listEligible). */
  const onAir = (at: Date) =>
    and(
      eq(campaigns.kind, 'commercial'),
      eq(campaigns.status, 'active'),
      lte(campaigns.startsAt, at),
      gt(campaigns.endsAt, at),
      sql`exists (select 1 from ${media} m where m.campaign_id = ${campaigns.id} and m.status = 'approved')`,
      sql`exists (select 1 from ${partners} p where p.id = ${campaigns.partnerId} and p.status = 'active')`,
      sql`not exists (select 1 from ${advertisers} a where a.id = ${campaigns.advertiserId} and a.archived_at is not null)`,
    );

  /** Today / 7 days / month counts in one query, plus the per-day series, within `scope` (joins campaigns). */
  async function playStats(scope: SQL | undefined, now: number) {
    const today = dayStart(now, 0);
    const week = dayStart(now, 6);
    const month = monthStart(now);
    const from = new Date(Math.min(month.getTime(), dayStart(now, SERIES_DAYS - 1).getTime()));
    const day = sql<string>`to_char(${plays.playedAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
    const [totals, rows] = await Promise.all([
      db
        .select({
          today: sql<number>`count(*) filter (where ${plays.playedAt} >= ${today})::int`,
          week: sql<number>`count(*) filter (where ${plays.playedAt} >= ${week})::int`,
          month: sql<number>`count(*) filter (where ${plays.playedAt} >= ${month})::int`,
        })
        .from(plays)
        .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
        .where(and(scope, gte(plays.playedAt, from))),
      db
        .select({ day, n })
        .from(plays)
        .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
        .where(and(scope, gte(plays.playedAt, dayStart(now, SERIES_DAYS - 1))))
        .groupBy(day),
    ]);
    const byDay = new Map(rows.map((r) => [r.day, r.n]));
    const days = Array.from({ length: SERIES_DAYS }, (_, i) => {
      const d = brDay(now - (SERIES_DAYS - 1 - i) * DAY_MS);
      return { day: d, count: byDay.get(d) ?? 0 };
    });
    const t = totals[0];
    return { playsToday: t?.today ?? 0, plays7d: t?.week ?? 0, playsMonth: t?.month ?? 0, days };
  }

  const countOf = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const pieces = (status: 'approved' | 'pending_review', where: SQL | undefined) =>
    countOf(db.select({ n }).from(media).innerJoin(campaigns, eq(campaigns.id, media.campaignId)).where(and(where, eq(media.status, status))));

  async function partnerDashboard(user: SessionUser, now: number) {
    const partnerId = user.partnerId!;
    const at = new Date(now);
    const own = and(eq(campaigns.partnerId, partnerId), eq(campaigns.kind, 'commercial'));
    const notCancelled = and(own, ne(campaigns.status, 'cancelled'));
    const [live, paused, activeAdvertisers, pendingPieces, paymentPending, expiring, tvUser, partner, playCounts] = await Promise.all([
      countOf(db.select({ n }).from(campaigns).where(and(eq(campaigns.partnerId, partnerId), onAir(at)))),
      countOf(db.select({ n }).from(campaigns).where(and(own, eq(campaigns.status, 'paused')))),
      countOf(db.select({ n }).from(advertisers).where(and(eq(advertisers.partnerId, partnerId), isNull(advertisers.archivedAt)))),
      pieces('pending_review', notCancelled),
      // Running or upcoming subscriptions still waiting for payment.
      countOf(db.select({ n }).from(campaigns).where(and(own, eq(campaigns.status, 'active'), gt(campaigns.endsAt, at), eq(campaigns.paymentStatus, 'pending')))),
      db
        .select({ id: campaigns.id, name: campaigns.name, endsAt: campaigns.endsAt })
        .from(campaigns)
        .where(and(eq(campaigns.partnerId, partnerId), onAir(at), lte(campaigns.endsAt, new Date(now + 30 * DAY_MS))))
        .orderBy(asc(campaigns.endsAt))
        .limit(5),
      db.select({ id: users.id }).from(users).where(and(eq(users.partnerId, partnerId), eq(users.role, 'player'))),
      db.select({ seen: partners.tvLastSeenAt }).from(partners).where(eq(partners.id, partnerId)),
      playStats(eq(plays.partnerId, partnerId), now),
    ]);
    const seen = partner[0]?.seen ?? null;
    const configured = tvUser.length > 0;
    return {
      role: 'partner' as const,
      stats: {
        live, paused, advertisers: activeAdvertisers, pendingPieces, paymentPending,
        playsToday: playCounts.playsToday, plays7d: playCounts.plays7d,
      },
      expiring,
      tv: { configured, lastSeenAt: seen, online: Boolean(configured && seen && now - seen.getTime() < ONLINE_MS) },
      days: playCounts.days,
    };
  }

  async function advertiserDashboard(user: SessionUser, now: number) {
    const at = new Date(now);
    const own = eq(campaigns.advertiserId, user.advertiserId!);
    const [live, livePieces, pendingPieces, playCounts] = await Promise.all([
      countOf(db.select({ n }).from(campaigns).where(and(own, onAir(at)))),
      pieces('approved', and(own, onAir(at))),
      pieces('pending_review', and(own, ne(campaigns.status, 'cancelled'))),
      playStats(own, now),
    ]);
    const { days, ...counts } = playCounts;
    return { role: 'advertiser' as const, stats: { live, livePieces, pendingPieces, ...counts }, days };
  }

  async function adminDashboard(now: number) {
    const at = new Date(now);
    const activePartner = eq(partners.status, 'active');
    const [activePartners, tvs, online, live, playCounts] = await Promise.all([
      countOf(db.select({ n }).from(partners).where(activePartner)),
      countOf(db.select({ n }).from(users).innerJoin(partners, eq(partners.id, users.partnerId)).where(and(eq(users.role, 'player'), activePartner))),
      countOf(
        db
          .select({ n })
          .from(users)
          .innerJoin(partners, eq(partners.id, users.partnerId))
          .where(and(eq(users.role, 'player'), activePartner, gt(partners.tvLastSeenAt, new Date(now - ONLINE_MS)))),
      ),
      countOf(db.select({ n }).from(campaigns).where(onAir(at))),
      playStats(undefined, now),
    ]);
    return {
      role: 'admin' as const,
      stats: { partners: activePartners, tvsTotal: tvs, tvsOnline: online, live, playsToday: playCounts.playsToday, plays7d: playCounts.plays7d },
      days: playCounts.days,
    };
  }

  app.get('/api/dashboard', { preHandler: requireRole('admin', 'partner_user', 'advertiser') }, async (req) => {
    const user = req.user!;
    const now = Date.now(); // one clock reading per request: every number refers to the same moment
    if (user.role === 'partner_user') return partnerDashboard(user, now);
    if (user.role === 'advertiser') return advertiserDashboard(user, now);
    return adminDashboard(now);
  });
};

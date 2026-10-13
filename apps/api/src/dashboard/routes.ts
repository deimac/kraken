import { and, asc, count, eq, gt, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../auth/guard';
import type { SessionUser } from '../auth/sessions';
import type { Db } from '../db/client';
import { advertisers, campaigns, media, partners, plays, users } from '../db/schema';

const DAY_MS = 86_400_000;
const SERIES_DAYS = 14;
const ONLINE_MS = 10 * 60_000;

/** Brasília calendar day (no DST since 2019: fixed -03:00, as in reports). */
const brDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
/** Start of the Brasília day `daysAgo` days before today. */
const dayStart = (daysAgo: number, now = Date.now()) => new Date(new Date(`${brDay(now)}T00:00:00-03:00`).getTime() - daysAgo * DAY_MS);
const monthStart = (now = Date.now()) => new Date(`${brDay(now).slice(0, 7)}-01T00:00:00-03:00`);

const n = sql<number>`count(*)::int`;

/** Home screen numbers for each role: what is on air, what needs attention, and plays per Brasília day. */
export const dashboardRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const now = () => new Date();
  const liveNow = () => and(eq(campaigns.status, 'active'), lte(campaigns.startsAt, now()), gt(campaigns.endsAt, now()));

  /** Play counts since a moment and per day for the last SERIES_DAYS days, within `scope` (joins campaigns). */
  async function playStats(scope: SQL | undefined) {
    const since = async (from: Date) =>
      (await db.select({ n }).from(plays).innerJoin(campaigns, eq(campaigns.id, plays.campaignId)).where(and(scope, gte(plays.playedAt, from))))[0]?.n ?? 0;
    const day = sql<string>`to_char(${plays.playedAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day, n })
      .from(plays)
      .innerJoin(campaigns, eq(campaigns.id, plays.campaignId))
      .where(and(scope, gte(plays.playedAt, dayStart(SERIES_DAYS - 1))))
      .groupBy(day);
    const byDay = new Map(rows.map((r) => [r.day, r.n]));
    const days = Array.from({ length: SERIES_DAYS }, (_, i) => {
      const d = brDay(Date.now() - (SERIES_DAYS - 1 - i) * DAY_MS);
      return { day: d, count: byDay.get(d) ?? 0 };
    });
    return {
      playsToday: await since(dayStart(0)),
      plays7d: await since(dayStart(6)),
      playsMonth: await since(monthStart()),
      days,
    };
  }

  async function subscriptionStats(scope: SQL) {
    const commercial = and(eq(campaigns.kind, 'commercial'), scope);
    const [live] = await db.select({ n }).from(campaigns).where(and(commercial, liveNow()));
    const [paused] = await db.select({ n }).from(campaigns).where(and(commercial, eq(campaigns.status, 'paused')));
    const open = and(commercial, ne(campaigns.status, 'cancelled'));
    const piecesOf = (status: 'approved' | 'pending_review', where: SQL | undefined) =>
      db.select({ n }).from(media).innerJoin(campaigns, eq(campaigns.id, media.campaignId)).where(and(where, eq(media.status, status)));
    const [pending] = await piecesOf('pending_review', open);
    const [livePieces] = await piecesOf('approved', and(commercial, liveNow()));
    return { live: live?.n ?? 0, paused: paused?.n ?? 0, pendingPieces: pending?.n ?? 0, livePieces: livePieces?.n ?? 0, open };
  }

  async function partnerDashboard(user: SessionUser) {
    const partnerId = user.partnerId!;
    const subs = await subscriptionStats(eq(campaigns.partnerId, partnerId));
    const [adv] = await db
      .select({ n })
      .from(advertisers)
      .where(and(eq(advertisers.partnerId, partnerId), sql`${advertisers.archivedAt} is null`));
    const [unpaid] = await db.select({ n }).from(campaigns).where(and(subs.open, eq(campaigns.paymentStatus, 'pending')));
    const expiring = await db
      .select({ id: campaigns.id, name: campaigns.name, endsAt: campaigns.endsAt, advertiserName: advertisers.name })
      .from(campaigns)
      .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
      .where(and(eq(campaigns.partnerId, partnerId), eq(campaigns.kind, 'commercial'), liveNow(), lte(campaigns.endsAt, new Date(Date.now() + 30 * DAY_MS))))
      .orderBy(asc(campaigns.endsAt))
      .limit(5);
    const [tvUser] = await db.select({ id: users.id }).from(users).where(and(eq(users.partnerId, partnerId), eq(users.role, 'player')));
    const [p] = await db.select({ seen: partners.tvLastSeenAt }).from(partners).where(eq(partners.id, partnerId));
    const seen = p?.seen ?? null;
    const { days, ...playCounts } = await playStats(eq(plays.partnerId, partnerId));
    return {
      role: 'partner' as const,
      stats: {
        live: subs.live, paused: subs.paused, advertisers: adv?.n ?? 0, pendingPieces: subs.pendingPieces, paymentPending: unpaid?.n ?? 0,
        ...playCounts,
      },
      expiring,
      tv: { configured: Boolean(tvUser), lastSeenAt: seen, online: Boolean(tvUser && seen && Date.now() - seen.getTime() < ONLINE_MS) },
      days,
    };
  }

  async function advertiserDashboard(user: SessionUser) {
    const scope = eq(campaigns.advertiserId, user.advertiserId!);
    const subs = await subscriptionStats(scope);
    const { days, ...playCounts } = await playStats(scope);
    return {
      role: 'advertiser' as const,
      stats: { live: subs.live, livePieces: subs.livePieces, pendingPieces: subs.pendingPieces, ...playCounts },
      days,
    };
  }

  async function adminDashboard() {
    const [partnerCount] = await db.select({ n }).from(partners).where(eq(partners.status, 'active'));
    const tvs = await db.select({ partnerId: users.partnerId }).from(users).where(eq(users.role, 'player'));
    const online = tvs.length
      ? await db
          .select({ n: count() })
          .from(partners)
          .where(and(inArray(partners.id, tvs.map((t) => t.partnerId!)), gt(partners.tvLastSeenAt, new Date(Date.now() - ONLINE_MS))))
      : [{ n: 0 }];
    const [live] = await db.select({ n }).from(campaigns).where(liveNow());
    const { days, ...playCounts } = await playStats(undefined);
    return {
      role: 'admin' as const,
      stats: { partners: partnerCount?.n ?? 0, tvsTotal: tvs.length, tvsOnline: online[0]?.n ?? 0, live: live?.n ?? 0, ...playCounts },
      days,
    };
  }

  app.get('/api/dashboard', { preHandler: requireRole('admin', 'partner_user', 'advertiser') }, async (req) => {
    const user = req.user!;
    if (user.role === 'partner_user') return partnerDashboard(user);
    if (user.role === 'advertiser') return advertiserDashboard(user);
    return adminDashboard();
  });
};

import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(() => t.close());

const ID = '00000000-0000-4000-8000-000000000000';
const PROTECTED: [string, string][] = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/admin/partners'], ['POST', '/api/admin/partners'], ['PATCH', `/api/admin/partners/${ID}`],
  ['POST', `/api/admin/partners/${ID}/users`],
  ['GET', '/api/partner'], ['GET', '/api/partner/users'], ['PUT', '/api/partner/player-account'],
  ['GET', '/api/partner/advertisers'], ['POST', '/api/partner/advertisers'], ['PATCH', `/api/partner/advertisers/${ID}`],
  ['GET', '/api/partner/plans'], ['POST', '/api/partner/plans'], ['PATCH', `/api/partner/plans/${ID}`],
  ['GET', '/api/advertiser'], ['GET', '/api/advertiser/plans'],
  ['GET', '/api/campaigns'], ['POST', '/api/campaigns'], ['GET', `/api/campaigns/${ID}`], ['PATCH', `/api/campaigns/${ID}`],
  ['POST', `/api/campaigns/${ID}/media`], ['POST', `/api/campaigns/${ID}/submit`], ['POST', `/api/campaigns/${ID}/approve`],
  ['POST', `/api/campaigns/${ID}/request-changes`], ['POST', `/api/campaigns/${ID}/cancel`],
  ['GET', '/api/admin/campaigns'], ['POST', '/api/admin/campaigns'], ['POST', `/api/admin/campaigns/${ID}/media`],
  ['POST', `/api/admin/campaigns/${ID}/cancel`],
  ['GET', `/api/media/${ID}`], ['GET', '/api/player/manifest'], ['POST', '/api/player/plays'],
  ['GET', '/api/reports/plays?from=2026-10-01&to=2026-10-02'], ['GET', '/api/reports/plays.csv?from=2026-10-01&to=2026-10-02'], ['GET', '/api/player/me'], ['PATCH', '/api/partner/settings'],
  ['GET', '/api/admin/kraken-plans'], ['POST', '/api/admin/kraken-plans'], ['PATCH', `/api/admin/kraken-plans/${ID}`],
];

it.each(PROTECTED)('%s %s requires a session', async (method, url) => {
  const res = await t.app.inject({ method: method as 'GET', url, payload: method === 'GET' ? undefined : {} });
  expect(res.statusCode).toBe(401);
});

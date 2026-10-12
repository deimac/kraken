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
  ['GET', '/api/advertiser'],
  ['GET', '/api/campaigns'], ['POST', '/api/campaigns'], ['GET', `/api/campaigns/${ID}`], ['PATCH', `/api/campaigns/${ID}`],
  ['POST', `/api/campaigns/${ID}/media`], ['POST', `/api/campaigns/${ID}/submit`], ['POST', `/api/campaigns/${ID}/approve`],
  ['POST', `/api/campaigns/${ID}/request-changes`], ['POST', `/api/campaigns/${ID}/cancel`],
  ['GET', '/api/admin/campaigns'], ['POST', '/api/admin/campaigns'], ['POST', `/api/admin/campaigns/${ID}/media`],
  ['POST', `/api/admin/campaigns/${ID}/cancel`],
  ['GET', `/api/media/${ID}`],
];

it.each(PROTECTED)('%s %s requires a session', async (method, url) => {
  const res = await t.app.inject({ method: method as 'GET', url, payload: method === 'GET' ? undefined : {} });
  expect(res.statusCode).toBe(401);
});

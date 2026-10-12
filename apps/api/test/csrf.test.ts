import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const create = (headers: Record<string, string>) =>
  t.app.inject({
    method: 'POST',
    url: '/api/partner/plans',
    headers: { cookie: s.gerenteA, host: 'midora.test', ...headers },
    payload: { name: 'P', frequencyLevel: 'low' },
  });

it('blocks cross-site requests', async () => {
  expect((await create({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
  expect((await create({ origin: 'https://evil.example' })).statusCode).toBe(403);
});

it('allows same-origin and non-browser requests', async () => {
  expect((await create({ 'sec-fetch-site': 'same-origin', origin: 'http://midora.test' })).statusCode).toBe(201);
  expect((await create({})).statusCode).toBe(201);
});

it('does not block GET requests', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/partner/plans', headers: { cookie: s.gerenteA, 'sec-fetch-site': 'cross-site' } });
  expect(res.statusCode).toBe(200);
});

import { expect, it } from 'vitest';
import { buildApp } from '../src/app';

it('GET /api/health returns ok and version', async () => {
  const app = await buildApp({ version: 'test-1' });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', version: 'test-1' });
  await app.close();
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let tvA: string;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  const { code } = (await t.app.inject({ method: 'POST', url: '/api/partner/player-code', headers: { cookie: s.gerenteA } })).json();
  const login = await t.app.inject({ method: 'POST', url: '/api/player/code-login', payload: { code } });
  tvA = `kraken_tv=${login.cookies.find((c) => c.name === 'kraken_tv')!.value}`;
});
afterAll(() => t.close());

const events = [
  { kind: 'load_timeout', mediaId: '0190a000-0000-7000-8000-000000000001', detail: 'readyState=1 networkState=2', at: '2026-10-13T12:00:00Z' },
  { kind: 'play_rejected', detail: 'NotAllowedError', at: '2026-10-13T12:00:05Z' },
];

describe('TV diagnostics', () => {
  it('the TV reports problems and its partner sees them, newest first, with the TV browser', async () => {
    const res = await t.app.inject({
      method: 'POST', url: '/api/player/events', headers: { cookie: tvA, 'user-agent': 'Mozilla/5.0 (Linux; Android 9; AFTMM) Silk/120' },
      payload: { events },
    });
    expect(res.statusCode).toBe(204);
    const list = (await t.app.inject({ method: 'GET', url: '/api/partner/tv-events', headers: { cookie: s.gerenteA } })).json();
    expect(list.events.map((e: { kind: string }) => e.kind)).toEqual(['play_rejected', 'load_timeout']);
    expect(list.events[0]).toMatchObject({ detail: 'NotAllowedError', userAgent: expect.stringContaining('Silk') });
    expect((await t.app.inject({ method: 'GET', url: '/api/partner/tv-events', headers: { cookie: s.gerenteB } })).json().events).toEqual([]);
  });

  it('validates input and requires a TV session', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/player/events', payload: { events } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/player/events', headers: { cookie: tvA }, payload: { events: [{ kind: 'x'.repeat(200), at: 'ontem' }] } })).statusCode).toBe(400);
  });

  it('keeps only the latest 100 events per partner', async () => {
    for (let i = 0; i < 3; i++) {
      await t.app.inject({
        method: 'POST', url: '/api/player/events', headers: { cookie: tvA },
        payload: { events: Array.from({ length: 50 }, (_, j) => ({ kind: 'stalled', detail: `${i}-${j}`, at: '2026-10-13T12:00:00Z' })) },
      });
    }
    const list = (await t.app.inject({ method: 'GET', url: '/api/partner/tv-events', headers: { cookie: s.gerenteA } })).json();
    expect(list.events).toHaveLength(100);
    expect(list.events[0].detail).toBe('2-49');
  });
});

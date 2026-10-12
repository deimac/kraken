import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTvSession } from '../src/session';

afterEach(() => vi.unstubAllGlobals());
const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url === '/api/player/me' ? new Response(JSON.stringify(body), { status }) : new Response('{}', { status: 404 })));

describe('isTvSession', () => {
  it('only sends the TV to login on 401/403 or a non-TV account', async () => {
    respond(200, { user: { role: 'player' } });
    expect(await isTvSession()).toBe(true);
    respond(200, { user: { role: 'partner_user' } });
    expect(await isTvSession()).toBe(false);
    respond(401, { error: 'unauthenticated' });
    expect(await isTvSession()).toBe(false);
    respond(502, {});
    expect(await isTvSession()).toBe(true); // server restarting: keep trying to play
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await isTvSession()).toBe(true);
  });
});

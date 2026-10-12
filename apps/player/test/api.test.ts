import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('parses JSON and throws ApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === '/ok'
        ? new Response(JSON.stringify({ a: 1 }), { status: 200 })
        : new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })));
    expect(await api('/ok')).toEqual({ a: 1 });
    await expect(api('/no')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/no')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});

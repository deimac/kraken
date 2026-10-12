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

  it('aborts requests that hang', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const p = api('/slow', { timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });
});


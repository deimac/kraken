import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { createManifestClient } from '../src/manifest';
import type { Manifest } from '../src/types';

const manifest = (n: number): Manifest => ({
  partner: { name: 'P', weights: { low: 1, medium: 2, high: 3 }, transition: 'fade', transitionMs: 600 },
  items: Array.from({ length: n }, (_, i) => ({
    campaignId: `c${i}`, kind: 'commercial', name: `c${i}`, frequencyLevel: 'low',
    media: { id: `m${i}`, url: `/api/media/m${i}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 5 },
  })),
  generatedAt: '2026-10-12T00:00:00Z',
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('manifest client', () => {
  it('polls every interval and keeps the last good manifest when the network fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(manifest(2)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(manifest(3));
    const client = createManifestClient(fetcher, { intervalMs: 1000 });
    await client.start();
    expect(client.current()!.items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.current()!.items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.current()!.items).toHaveLength(3);
    client.stop();
  });

  it('retries sooner when empty and reports 401', async () => {
    const onUnauthorized = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(manifest(0)).mockRejectedValueOnce(new ApiError(401, 'unauthenticated'));
    const client = createManifestClient(fetcher, { intervalMs: 60_000, emptyRetryMs: 500, onUnauthorized });
    await client.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    client.stop();
  });
});

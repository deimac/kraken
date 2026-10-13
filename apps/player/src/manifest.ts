import { ApiError } from './api';
import type { Manifest } from './types';

export function createManifestClient(
  fetcher: () => Promise<Manifest>,
  opts: { intervalMs?: number; emptyRetryMs?: number; onUnauthorized?: () => void } = {},
) {
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const emptyRetryMs = opts.emptyRetryMs ?? 30_000;
  let current: Manifest | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function refresh() {
    try {
      current = await fetcher();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) opts.onUnauthorized?.();
      // Network or server error: keep playing the last good manifest.
    }
  }

  async function tick() {
    await refresh();
    if (stopped) return;
    // The partner chooses how often its TVs look for new ads (Conta da TV); older servers send nothing.
    const every = current?.partner.refreshSeconds ? current.partner.refreshSeconds * 1000 : intervalMs;
    timer = setTimeout(() => void tick(), current && current.items.length > 0 ? every : Math.min(emptyRetryMs, every));
  }

  return {
    start: () => tick(),
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    current: () => current,
  };
}

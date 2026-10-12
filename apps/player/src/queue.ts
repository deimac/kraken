import type { Item } from './types';
import { uuidv7 } from './uuid';

export interface PlayEvent {
  id: string;
  campaignId: string;
  mediaId: string;
  playedAt: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function playEvent(item: Item, now: Date = new Date()): PlayEvent {
  return { id: uuidv7(now.getTime()), campaignId: item.campaignId, mediaId: item.media.id, playedAt: now.toISOString() };
}

function isPlayEvent(v: unknown): v is PlayEvent {
  const e = v as Partial<PlayEvent> | null;
  return (
    !!e && typeof e.id === 'string' && typeof e.campaignId === 'string' &&
    typeof e.mediaId === 'string' && typeof e.playedAt === 'string'
  );
}

function defaultStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Plays waiting to reach the server; survives reloads so no completed play is lost. */
export function createPlayQueue(opts: {
  send(batch: PlayEvent[], sentAt: string): Promise<{ accepted: string[]; rejected: string[] }>;
  storage?: Store | null;
  key?: string;
  max?: number;
  batchSize?: number;
}) {
  const key = opts.key ?? 'kraken-plays';
  // ~180 bytes per event: 20k stays well inside the ~5 MB localStorage quota.
  const max = opts.max ?? 20_000;
  const batchSize = opts.batchSize ?? 200;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  let queue: PlayEvent[] = load();
  let flushing: Promise<boolean> | null = null;

  function load(): PlayEvent[] {
    try {
      const raw = storage?.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter(isPlayEvent) : [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      storage?.setItem(key, JSON.stringify(queue));
    } catch {
      /* storage full or blocked: keep in memory */
    }
  }

  async function run(): Promise<boolean> {
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, batchSize);
        let res: { accepted: string[]; rejected: string[] };
        try {
          res = await opts.send(batch, new Date().toISOString());
        } catch (err) {
          // The server refused the batch itself: drop it rather than block every later play.
          if ((err as { status?: number }).status !== 400) throw err;
          res = { accepted: [], rejected: batch.map((e) => e.id) };
        }
        const done = new Set([...res.accepted, ...res.rejected]);
        const before = queue.length;
        queue = queue.filter((e) => !done.has(e.id));
        persist();
        if (queue.length === before) break; // the server answered nothing about this batch
      }
      return true;
    } catch {
      return false; // offline or server error: try again later
    }
  }

  return {
    add(e: PlayEvent) {
      queue.push(e);
      if (queue.length > max) queue = queue.slice(queue.length - max);
      persist();
    },
    flush(): Promise<boolean> {
      if (!flushing) flushing = run().finally(() => (flushing = null));
      return flushing;
    },
    size: () => queue.length,
  };
}

import { describe, expect, it, vi } from 'vitest';
import { createPlayQueue, playEvent, type PlayEvent } from '../src/queue';
import type { Item } from '../src/types';

const ev = (n: number): PlayEvent => ({ id: `id-${n}`, campaignId: 'c', mediaId: 'm', playedAt: '2026-10-12T12:00:00.000Z' });

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('play queue', () => {
  it('survives a restart through storage', () => {
    const storage = memoryStorage();
    const q1 = createPlayQueue({ send: vi.fn(), storage });
    q1.add(ev(1));
    q1.add(ev(2));
    const q2 = createPlayQueue({ send: vi.fn(), storage });
    expect(q2.size()).toBe(2);
  });

  it('sends in batches and drops accepted and rejected ids', async () => {
    const send = vi.fn(async (batch: PlayEvent[]) => ({
      accepted: batch.filter((e) => e.id !== 'id-3').map((e) => e.id),
      rejected: batch.filter((e) => e.id === 'id-3').map((e) => e.id),
    }));
    const q = createPlayQueue({ send, storage: memoryStorage(), batchSize: 2 });
    for (let i = 1; i <= 5; i++) q.add(ev(i));
    expect(await q.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![0].map((e) => e.id)).toEqual(['id-1', 'id-2']);
    expect(q.size()).toBe(0);
  });

  it('keeps everything when the network fails', async () => {
    const q = createPlayQueue({ send: vi.fn(async () => { throw new TypeError('offline'); }), storage: memoryStorage() });
    q.add(ev(1));
    expect(await q.flush()).toBe(false);
    expect(q.size()).toBe(1);
  });

  it('never runs two flushes at once', async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<{ accepted: string[]; rejected: string[] }>((r) => { release = () => r({ accepted: ['id-1'], rejected: [] }); }));
    const q = createPlayQueue({ send, storage: memoryStorage() });
    q.add(ev(1));
    const a = q.flush();
    const b = q.flush();
    release();
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps the backlog, dropping the oldest', () => {
    const q = createPlayQueue({ send: vi.fn(), storage: memoryStorage(), max: 3 });
    for (let i = 1; i <= 5; i++) q.add(ev(i));
    expect(q.size()).toBe(3);
  });

  it('works without storage', () => {
    const q = createPlayQueue({ send: vi.fn(), storage: null });
    q.add(ev(1));
    expect(q.size()).toBe(1);
  });

  it('builds an event from a played item', () => {
    const item = { campaignId: 'c1', media: { id: 'm1' } } as Item;
    const e = playEvent(item, new Date('2026-10-12T15:00:00Z'));
    expect(e).toMatchObject({ campaignId: 'c1', mediaId: 'm1', playedAt: '2026-10-12T15:00:00.000Z' });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

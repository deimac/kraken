import { describe, expect, it } from 'vitest';
import { createRotation } from '../src/rotation';
import type { Item, Level } from '../src/types';

const W = { low: 1, medium: 2, high: 3 };
const item = (id: string, level: Level, piece = id): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: level,
  media: { id: `m-${piece}`, url: `/api/media/m-${piece}`, mediaType: 'image', mime: 'image/png', sha256: 'x', sizeBytes: 1, durationMs: null, displaySeconds: 10 },
});

function run(items: Item[], n: number, weights = W) {
  const r = createRotation(items, weights);
  const seq: string[] = [];
  for (let i = 0; i < n; i++) seq.push(r.next()!.campaignId);
  return seq;
}
const count = (seq: string[], id: string) => seq.filter((x) => x === id).length;
const repeats = (seq: string[]) => seq.filter((x, i) => i > 0 && x === seq[i - 1]).length;

describe('createRotation', () => {
  it('returns null when there is nothing to play', () => {
    expect(createRotation([], W).next()).toBeNull();
  });

  it('keeps the exact 1:2:3 proportion without consecutive repeats', () => {
    const seq = run([item('L', 'low'), item('M', 'medium'), item('H', 'high')], 6000);
    expect(count(seq, 'L')).toBe(1000);
    expect(count(seq, 'M')).toBe(2000);
    expect(count(seq, 'H')).toBe(3000);
    expect(repeats(seq)).toBe(0);
  });

  it('honors partner weights and repeats only when the proportion requires it', () => {
    const seq = run([item('H', 'high'), item('L', 'low')], 4000);
    expect(count(seq, 'H')).toBe(3000);
    expect(count(seq, 'L')).toBe(1000);
    const custom = run([item('L', 'low'), item('H', 'high')], 600, { low: 1, medium: 1, high: 5 });
    expect(count(custom, 'H')).toBe(500);
  });

  it('loops a single item', () => {
    expect(run([item('A', 'low')], 3)).toEqual(['A', 'A', 'A']);
  });

  it('spreads many items evenly per level', () => {
    const items = [item('L1', 'low'), item('L2', 'low'), item('M1', 'medium'), item('H1', 'high')];
    const seq = run(items, 7000);
    expect(count(seq, 'L1')).toBe(1000);
    expect(count(seq, 'L2')).toBe(1000);
    expect(count(seq, 'M1')).toBe(2000);
    expect(count(seq, 'H1')).toBe(3000);
  });

  it('weights subscriptions, not pieces, and alternates pieces inside a subscription', () => {
    const items = [item('H', 'high', 'h1'), item('H', 'high', 'h2'), item('L', 'low', 'l1')];
    const r = createRotation(items, W);
    const pieces: string[] = [];
    for (let i = 0; i < 4000; i++) pieces.push(r.next()!.media.id);
    expect(count(pieces, 'm-h1')).toBe(1500);
    expect(count(pieces, 'm-h2')).toBe(1500);
    expect(count(pieces, 'm-l1')).toBe(1000);
    // the same piece never plays twice in a row while there is another one to show
    expect(repeats(pieces)).toBe(0);
  });
});

describe('createRotation with a different order on each TV', () => {
  // Small seeded generator: each "TV" gets its own sequence of random numbers.
  const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shuffled = (items: Item[], n: number, seed: number, field: 'campaignId' | 'media' = 'campaignId') => {
    const r = createRotation(items, W, { random: seeded(seed) });
    const seq: string[] = [];
    for (let i = 0; i < n; i++) {
      const it = r.next()!;
      seq.push(field === 'media' ? it.media.id : it.campaignId);
    }
    return seq;
  };
  const mix = [item('L', 'low'), item('M', 'medium'), item('H', 'high')];

  it('keeps the 1:2:3 proportion and never airs the same subscription twice in a row', () => {
    for (const seed of [1, 2, 3, 42]) {
      const seq = shuffled(mix, 6000, seed);
      expect(Math.abs(count(seq, 'L') - 1000)).toBeLessThanOrEqual(2);
      expect(Math.abs(count(seq, 'M') - 2000)).toBeLessThanOrEqual(2);
      expect(Math.abs(count(seq, 'H') - 3000)).toBeLessThanOrEqual(2);
      expect(repeats(seq)).toBe(0);
    }
  });

  it('two TVs do not follow the same order', () => {
    const equal = ['A', 'B', 'C', 'D', 'E'].map((id) => item(id, 'low'));
    expect(shuffled(equal, 30, 1).join()).not.toBe(shuffled(equal, 30, 2).join());
  });

  it('the order changes from one round to the next, not just where it starts', () => {
    const equal = ['A', 'B', 'C', 'D', 'E'].map((id) => item(id, 'low'));
    const seq = shuffled(equal, 50, 7);
    const rounds = new Set<string>();
    for (let i = 0; i < 50; i += 5) {
      const round = seq.slice(i, i + 5);
      expect(new Set(round).size).toBe(5); // every subscription once per round
      rounds.add(round.join());
    }
    expect(rounds.size).toBeGreaterThan(1);
    expect(repeats(seq)).toBe(0);
  });

  it('pieces of one subscription share its turns evenly, in varying order', () => {
    const pieces = ['p1', 'p2', 'p3'].map((p) => item('S', 'low', p));
    const seq = shuffled(pieces, 300, 5, 'media');
    for (const p of ['m-p1', 'm-p2', 'm-p3']) expect(count(seq, p)).toBe(100);
    expect(repeats(seq)).toBe(0);
    const laps = new Set<string>();
    for (let i = 0; i < 300; i += 3) laps.add(seq.slice(i, i + 3).join());
    expect(laps.size).toBeGreaterThan(1);
  });
});

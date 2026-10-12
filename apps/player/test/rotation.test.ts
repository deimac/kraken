import { describe, expect, it } from 'vitest';
import { createRotation } from '../src/rotation';
import type { Item, Level } from '../src/types';

const W = { low: 1, medium: 2, high: 3 };
const item = (id: string, level: Level): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: level,
  media: { id: `m-${id}`, url: `/api/media/m-${id}`, mediaType: 'image', mime: 'image/png', sha256: 'x', sizeBytes: 1, durationMs: null, displaySeconds: 10 },
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
});

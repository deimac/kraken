import type { Item, Level } from './types';

export interface Rotation {
  next(): Item | null;
}

/**
 * Smooth weighted round-robin (as in nginx): exact proportions, evenly spread.
 * Avoids playing the same campaign twice in a row only when another campaign
 * is owed a turn, so the configured proportion is never distorted.
 */
export function createRotation(items: Item[], weights: Record<Level, number>): Rotation {
  const entries = items.map((item) => ({ item, weight: Math.max(1, weights[item.frequencyLevel]), credit: 0 }));
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let last: (typeof entries)[number] | null = null;

  return {
    next() {
      if (entries.length === 0) return null;
      for (const e of entries) e.credit += e.weight;
      let best = entries[0]!;
      let second: (typeof entries)[number] | null = null;
      for (const e of entries.slice(1)) {
        if (e.credit > best.credit) {
          second = best;
          best = e;
        } else if (!second || e.credit > second.credit) {
          second = e;
        }
      }
      const pick = best === last && second && second.credit > 0 ? second : best;
      pick.credit -= total;
      last = pick;
      return pick.item;
    },
  };
}

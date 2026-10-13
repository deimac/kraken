import type { Item, Level } from './types';

export interface Rotation {
  next(): Item | null;
}

/**
 * Smooth weighted round-robin (as in nginx) over subscriptions: exact proportions, evenly spread. Each subscription's
 * pieces take turns inside its share, so adding pieces never changes how often a subscription airs.
 * Avoids playing the same subscription twice in a row only when another one is owed a turn, so the configured
 * proportion is never distorted.
 */
export function createRotation(items: Item[], weights: Record<Level, number>): Rotation {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const list = groups.get(item.campaignId);
    if (list) list.push(item);
    else groups.set(item.campaignId, [item]);
  }
  const entries = [...groups.values()].map((pieces) => ({
    pieces, cursor: 0, weight: Math.max(1, weights[pieces[0]!.frequencyLevel]), credit: 0,
  }));
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
      const piece = pick.pieces[pick.cursor % pick.pieces.length]!;
      pick.cursor += 1;
      return piece;
    },
  };
}

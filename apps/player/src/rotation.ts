import type { Item, Level } from './types';

export interface Rotation {
  next(): Item | null;
}

/**
 * Smooth weighted round-robin (as in nginx) over subscriptions: exact proportions, evenly spread. Each subscription's
 * pieces take turns inside its share, so adding pieces never changes how often a subscription airs.
 * Avoids playing the same subscription twice in a row only when another one is owed a turn, so the configured
 * proportion is never distorted.
 *
 * With `random` (a different order on each TV), ties are broken by lot instead of by list position and each
 * subscription's pieces are reshuffled every lap: proportions stay exact, but each TV (and each round) gets its own order.
 */
export function createRotation(items: Item[], weights: Record<Level, number>, opts: { random?: () => number } = {}): Rotation {
  const { random } = opts;
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
      const order = random ? shuffle(entries, random) : entries;
      let best = order[0]!;
      let second: (typeof entries)[number] | null = null;
      for (const e of order.slice(1)) {
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
      const lap = pick.cursor % pick.pieces.length;
      if (random && lap === 0 && pick.pieces.length > 1) {
        const previous = pick.pieces.at(-1)!;
        pick.pieces = shuffle(pick.pieces, random);
        // Never the same piece twice in a row across laps.
        if (pick.pieces[0] === previous) pick.pieces.push(pick.pieces.shift()!);
      }
      const piece = pick.pieces[lap]!;
      pick.cursor += 1;
      return piece;
    },
  };
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

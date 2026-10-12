import { createRotation, type Rotation } from './rotation';
import type { Item, Manifest, Transition } from './types';

export type PlayResult = 'completed' | 'failed';

export interface Screen {
  /** Loads the item into the hidden layer; true when it can start without stalling. */
  preload(item: Item): Promise<boolean>;
  /** Transitions the preloaded item in and resolves when it finished (or failed). */
  present(item: Item): Promise<PlayResult>;
  setTransition(type: Transition, ms: number): void;
  setMuted(muted: boolean): void;
  showWaiting(on: boolean): void;
}

interface Deps {
  screen: Screen;
  manifest(): Manifest | null;
  sleep(ms: number): Promise<void>;
  running(): boolean;
  onPlayed?(item: Item, result: PlayResult): void;
  idleMs?: number;
}

/** Plays ads forever, always preloading the next one while the current one is on screen. */
export async function runPlayer(deps: Deps): Promise<void> {
  const { screen } = deps;
  const idleMs = deps.idleMs ?? 10_000;
  let source: Manifest | null = null;
  let rotation: Rotation | null = null;
  let pending: { item: Item; ready: Promise<boolean> } | null = null;
  let failures = 0;

  while (deps.running()) {
    const m = deps.manifest();
    if (!m || m.items.length === 0) {
      pending = null;
      screen.showWaiting(true);
      await deps.sleep(idleMs);
      continue;
    }
    if (m !== source) {
      source = m;
      rotation = createRotation(m.items, m.partner.weights);
      screen.setTransition(m.partner.transition, m.partner.transitionMs);
      const stillListed = pending !== null && m.items.some((i) => i.campaignId === pending!.item.campaignId);
      if (!stillListed) pending = null;
    }
    if (!pending) {
      const first = rotation!.next()!;
      pending = { item: first, ready: screen.preload(first) };
    }

    const current = pending;
    pending = null;
    if (!(await current.ready)) {
      failures++;
      if (failures >= m.items.length) {
        // Nothing loads (network down, broken files): rest instead of spinning.
        failures = 0;
        screen.showWaiting(true);
        await deps.sleep(idleMs);
      }
      continue;
    }

    screen.showWaiting(false);
    const playing = screen.present(current.item);
    const next = rotation!.next()!;
    pending = { item: next, ready: screen.preload(next) };
    const result = await playing;
    failures = result === 'failed' ? failures + 1 : 0;
    deps.onPlayed?.(current.item, result);
  }
}

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
  /** Keeps the last frame of the video that just ended on screen and frees the TV's video decoder. */
  freezeVideo?(): void;
  /** Downloads a video's file ahead (no decoding) so it can start right after the current video. */
  prefetch?(item: Item): void;
  /** Codecs of the server's TV-optimized videos (MediaSource sequence playback). */
  setTvCodecs?(codecs: string | undefined): void;
  /** True when `next` can follow `current` on the same video decoder (MediaSource), with no gap. */
  canChain?(current: Item, next: Item): boolean;
}

interface Deps {
  screen: Screen;
  manifest(): Manifest | null;
  sleep(ms: number): Promise<void>;
  running(): boolean;
  onPlayed?(item: Item, result: PlayResult): void;
  idleMs?: number;
  /** Source of randomness for a per-TV order (tests pass a fixed one). */
  random?: () => number;
}

/** Identity of what the rotation depends on; polls returning the same content keep the rotation. */
function signature(m: Manifest): string {
  const w = m.partner.weights;
  return [w.low, w.medium, w.high, m.partner.shuffle ? 'shuffle' : '', ...m.items.map((i) => `${i.campaignId}:${i.media.id}:${i.frequencyLevel}:${i.media.tvUrl ? 'tv' : ''}`)].join('|');
}

/** Plays ads forever, always preloading the next one while the current one is on screen. */
export async function runPlayer(deps: Deps): Promise<void> {
  const { screen } = deps;
  const idleMs = deps.idleMs ?? 10_000;
  let source: Manifest | null = null;
  let sourceSignature = '';
  let rotation: Rotation | null = null;
  type Pending = { item: Item; ready: Promise<boolean>; retried?: boolean };
  let pending: Pending | null = null;
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
      if (!source || m.partner.transition !== source.partner.transition || m.partner.transitionMs !== source.partner.transitionMs) {
        screen.setTransition(m.partner.transition, m.partner.transitionMs);
      }
      source = m;
      screen.setTvCodecs?.(m.tvCodecs);
      const sig = signature(m);
      if (sig !== sourceSignature) {
        sourceSignature = sig;
        rotation = createRotation(m.items, m.partner.weights, m.partner.shuffle ? { random: deps.random ?? Math.random } : {});
        const stillListed =
          pending !== null && m.items.some((i) => i.campaignId === pending!.item.campaignId && i.media.id === pending!.item.media.id);
        if (!stillListed) pending = null;
      }
    }
    if (!pending) {
      const first = rotation!.next()!;
      pending = { item: first, ready: screen.preload(first) };
    }

    const current: Pending = pending;
    pending = null;
    if (!(await current.ready)) {
      // TVs can take a moment to free the decoder of the video that just ended: try once more before skipping.
      if (current.item.media.mediaType === 'video' && !current.retried) {
        await deps.sleep(1500);
        pending = { item: current.item, ready: screen.preload(current.item), retried: true };
        continue;
      }
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
    // Fire TV and many TVs decode one video at a time: loading the next video while one plays turns both black.
    // Video after video waits for the first to end (its last frame stays on screen); images load meanwhile.
    const oneDecoder =
      current.item.media.mediaType === 'video' && next.media.mediaType === 'video' && !screen.canChain?.(current.item, next);
    if (oneDecoder) screen.prefetch?.(next);
    else pending = { item: next, ready: screen.preload(next) };
    const result = await playing;
    if (oneDecoder) {
      screen.freezeVideo?.();
      pending = { item: next, ready: screen.preload(next) };
    }
    deps.onPlayed?.(current.item, result);
    if (result === 'completed') {
      failures = 0;
    } else if (++failures >= m.items.length) {
      // Every ad refuses to play: rest instead of spinning.
      failures = 0;
      pending = null;
      screen.showWaiting(true);
      await deps.sleep(idleMs);
    }
  }
}

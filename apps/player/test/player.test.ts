import { describe, expect, it, vi } from 'vitest';
import { runPlayer, type PlayResult, type Screen } from '../src/player';
import type { Item, Level, Manifest } from '../src/types';

const item = (id: string, level: Level = 'low'): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: level,
  media: { id: `m-${id}`, url: `/api/media/m-${id}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 5 },
});
const manifest = (items: Item[], transition: Manifest['partner']['transition'] = 'fade'): Manifest => ({
  partner: { name: 'P', weights: { low: 1, medium: 2, high: 3 }, transition, transitionMs: 600 },
  items,
  generatedAt: 'x',
});

class FakeScreen implements Screen {
  log: string[] = [];
  failPreload = new Set<string>();
  failOnce = new Set<string>();
  results: PlayResult[] = [];
  preload = vi.fn(async (i: Item) => {
    this.log.push(`preload ${i.campaignId}`);
    if (this.failOnce.delete(i.campaignId)) return false;
    return !this.failPreload.has(i.campaignId);
  });
  present = vi.fn(async (i: Item) => {
    this.log.push(`present ${i.campaignId}`);
    this.lastPresented = i.campaignId;
    await Promise.resolve();
    this.log.push(`end ${i.campaignId}`);
    return this.results.shift() ?? 'completed';
  });
  setTransition = vi.fn();
  setMuted = vi.fn();
  freezeVideo = vi.fn(() => this.log.push(`freeze ${this.lastPresented}`));
  prefetch = vi.fn((i: Item) => this.log.push(`prefetch ${i.campaignId}`));
  lastPresented = '';
  showWaiting = vi.fn((on: boolean) => this.log.push(`waiting ${on}`));
}

function until(n: number) {
  let calls = 0;
  return () => calls++ < n;
}

const video = (id: string): Item => ({ ...item(id), media: { ...item(id).media, mediaType: 'video', mime: 'video/mp4', durationMs: 15000, displaySeconds: null } });

describe('runPlayer', () => {
  it('retries a video that failed to load right after another video before skipping it', async () => {
    const screen = new FakeScreen();
    screen.failOnce.add('B');
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([video('A'), video('B')]), sleep, running: until(3) });
    const presented = screen.log.filter((l) => l.startsWith('present'));
    expect(presented.slice(0, 2)).toEqual(['present A', 'present B']);
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it('plays videos back to back one at a time: the next video loads only after the current one ended', async () => {
    const screen = new FakeScreen();
    await runPlayer({ screen, manifest: () => manifest([video('A'), video('B'), item('C')]), sleep: async () => {}, running: until(3) });
    const log = screen.log;
    // Fire TV and many TVs decode a single video: B waits for A, whose last frame stays on screen meanwhile
    expect(log.indexOf('preload B')).toBeGreaterThan(log.indexOf('end A'));
    expect(log.indexOf('freeze A')).toBeGreaterThan(log.indexOf('end A'));
    expect(log.indexOf('freeze A')).toBeLessThan(log.indexOf('preload B'));
    // while A plays, B's file is downloaded (no decoding) so it starts right after A
    expect(log).toContain('prefetch B');
    expect(log.indexOf('prefetch B')).toBeLessThan(log.indexOf('end A'));
    // an image can still be prepared while a video plays
    expect(log.indexOf('preload C')).toBeLessThan(log.indexOf('end B'));
  });

  it('preloads the next ad while the current one plays', async () => {
    const screen = new FakeScreen();
    await runPlayer({ screen, manifest: () => manifest([item('A'), item('B')]), sleep: async () => {}, running: until(2) });
    expect(screen.log.slice(0, 6)).toEqual(['preload A', 'waiting false', 'present A', 'preload B', 'end A', 'waiting false']);
    expect(screen.setTransition).toHaveBeenCalledWith('fade', 600);
  });

  it('loops a single ad', async () => {
    const screen = new FakeScreen();
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => manifest([item('A')]), sleep: async () => {}, running: until(3),
      onPlayed: (i) => played.push(i.campaignId),
    });
    expect(played).toEqual(['A', 'A', 'A']);
  });

  it('skips ads that fail to load and shows waiting when all fail', async () => {
    const screen = new FakeScreen();
    screen.failPreload = new Set(['A', 'B']);
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([item('A'), item('B')]), sleep, running: until(5), idleMs: 10_000 });
    expect(screen.present).not.toHaveBeenCalled();
    expect(screen.log).toContain('waiting true');
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('shows waiting when there is nothing to play', async () => {
    const screen = new FakeScreen();
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([]), sleep, running: until(2), idleMs: 7000 });
    expect(screen.log).toEqual(['waiting true', 'waiting true']);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('stops playing a campaign removed from the manifest', async () => {
    const screen = new FakeScreen();
    let current = manifest([item('A'), item('B')]);
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => current, sleep: async () => {}, running: until(6),
      onPlayed: (i) => {
        played.push(i.campaignId);
        if (played.length === 1) current = manifest([item('B')], 'cut');
      },
    });
    expect(played[0]).toBe('A');
    expect(played.slice(2)).not.toContain('A');
    expect(screen.setTransition).toHaveBeenLastCalledWith('cut', 600);
  });

  it('keeps the rotation when a poll returns the same content', async () => {
    const screen = new FakeScreen();
    const items = [item('L', 'low'), item('M', 'medium'), item('H', 'high')];
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => manifest(items.map((i) => ({ ...i }))), sleep: async () => {}, running: until(600),
      onPlayed: (i) => played.push(i.campaignId),
    });
    expect(played.filter((x) => x === 'H').length).toBe(300);
    expect(played.filter((x) => x === 'L').length).toBe(100);
    expect(played.filter((x, i) => i > 0 && x === played[i - 1]).length).toBe(0);
  });

  it('backs off when ads fail to play', async () => {
    const screen = new FakeScreen();
    screen.present = vi.fn(async () => 'failed' as const);
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([item('A'), item('B')]), sleep, running: until(6), idleMs: 9000 });
    expect(sleep).toHaveBeenCalledWith(9000);
    expect(screen.log).toContain('waiting true');
  });

  it('drops a preloaded ad whose media was replaced', async () => {
    const screen = new FakeScreen();
    let current = manifest([item('A'), item('B')]);
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => current, sleep: async () => {}, running: until(3),
      onPlayed: (i) => {
        played.push(i.media.id);
        if (played.length === 1) current = manifest([item('A'), { ...item('B'), media: { ...item('B').media, id: 'm-B2', url: '/api/media/m-B2' } }]);
      },
    });
    expect(played).not.toContain('m-B');
  });

  it('reports only completed plays', async () => {
    const screen = new FakeScreen();
    screen.results = ['completed', 'failed', 'completed'];
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => manifest([item('A'), item('B')]), sleep: async () => {}, running: until(3),
      onPlayed: (i, result) => { if (result === 'completed') played.push(i.campaignId); },
    });
    expect(played).toHaveLength(2);
  });
});


describe('runPlayer ad order', () => {
  const ids = ['A', 'B', 'C', 'D', 'E'];
  const order = async (shuffle: boolean, random: () => number) => {
    const screen = new FakeScreen();
    const m = manifest(ids.map((id) => item(id)));
    m.partner.shuffle = shuffle;
    await runPlayer({ screen, manifest: () => m, sleep: async () => {}, running: until(10), random });
    return screen.log.filter((l) => l.startsWith('present')).join();
  };

  it('each TV draws its own order when the partner chose a different order per TV', async () => {
    expect(await order(true, () => 0.99)).not.toBe(await order(true, () => 0.01));
  });

  it('every TV follows the same order otherwise', async () => {
    expect(await order(false, () => 0.99)).toBe(await order(false, () => 0.01));
  });
});

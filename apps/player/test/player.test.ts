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
  results: PlayResult[] = [];
  preload = vi.fn(async (i: Item) => {
    this.log.push(`preload ${i.campaignId}`);
    return !this.failPreload.has(i.campaignId);
  });
  present = vi.fn(async (i: Item) => {
    this.log.push(`present ${i.campaignId}`);
    await Promise.resolve();
    this.log.push(`end ${i.campaignId}`);
    return this.results.shift() ?? 'completed';
  });
  setTransition = vi.fn();
  setMuted = vi.fn();
  showWaiting = vi.fn((on: boolean) => this.log.push(`waiting ${on}`));
}

function until(n: number) {
  let calls = 0;
  return () => calls++ < n;
}

describe('runPlayer', () => {
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
});


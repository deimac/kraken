import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomScreen } from '../src/dom-screen';
import type { Item } from '../src/types';

const image = (id: string): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: 'low',
  media: { id, url: `/api/media/${id}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 2 },
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('DomScreen', () => {
  it('uses exactly two reusable layers and alternates them', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setTransition('fade', 0);
    expect(root.querySelectorAll('video')).toHaveLength(2);
    expect(root.querySelectorAll('img')).toHaveLength(2);

    expect(await screen.preload(image('a'))).toBe(true);
    const first = screen.present(image('a'));
    const layers = root.querySelectorAll('.layer');
    const onBefore = Array.from(layers).findIndex((l) => l.classList.contains('on'));
    expect(onBefore).toBeGreaterThanOrEqual(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toBe('completed');

    expect(await screen.preload(image('b'))).toBe(true);
    void screen.present(image('b'));
    await Promise.resolve();
    const onAfter = Array.from(layers).findIndex((l) => l.classList.contains('on'));
    expect(onAfter).not.toBe(onBefore);
    expect(root.querySelectorAll('video')).toHaveLength(2);
  });

  it('applies the transition type and duration to the stage', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setTransition('slide', 1000);
    const stage = root.querySelector('.stage') as HTMLElement;
    expect(stage.classList.contains('slide')).toBe(true);
    expect(stage.style.getPropertyValue('--t')).toBe('1000ms');
    screen.setTransition('cut', 1000);
    expect(stage.classList.contains('cut')).toBe(true);
    expect(stage.classList.contains('slide')).toBe(false);
  });

  it('fails a preload that never becomes ready', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => new Promise(() => {}) });
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root, { loadTimeoutMs: 1000 });
    const ready = screen.preload(image('slow'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await ready).toBe(false);
  });

  it('mutes and unmutes both videos', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setMuted(false);
    expect(Array.from(root.querySelectorAll('video')).every((v) => !v.muted)).toBe(true);
  });
});

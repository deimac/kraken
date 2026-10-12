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
    expect(root.querySelectorAll('.layer img')).toHaveLength(2);

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

const video = (id: string): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: 'low',
  media: { id, url: `/api/media/${id}`, mediaType: 'video', mime: 'video/mp4', sha256: 's', sizeBytes: 1, durationMs: 5000, displaySeconds: null },
});

describe('DomScreen with video', () => {
  it('never reuses the visible layer while a video is starting', async () => {
    let startPlay!: () => void;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise<void>((r) => { startPlay = r; }));
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root, { loadTimeoutMs: 50 });
    screen.setTransition('fade', 600);
    expect(await screen.preload(image('a'))).toBe(true);
    void screen.present(image('a'));
    const shown = root.querySelectorAll('.layer')[0]!.querySelector('img')!;
    await vi.advanceTimersByTimeAsync(2000);

    void screen.present(video('v'));
    void screen.preload(image('next'));
    await vi.advanceTimersByTimeAsync(10);
    expect(shown.getAttribute('src')).toBe('/api/media/a'); // still on screen, untouched
    startPlay();
    await vi.advanceTimersByTimeAsync(700);
    expect(shown.getAttribute('src')).toBe('/api/media/next'); // reused only after the transition
  });

  it('keeps the current ad on screen when a video refuses to play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setTransition('fade', 0);
    await screen.preload(image('a'));
    void screen.present(image('a'));
    const layers = root.querySelectorAll('.layer');
    expect(await screen.present(video('v'))).toBe('failed');
    expect(layers[0]!.classList.contains('on')).toBe(true);
    expect(await screen.preload(image('b'))).toBe(true);
    expect(layers[0]!.querySelector('img')!.getAttribute('src')).toBe('/api/media/a');
  });

  it('accepts canplay and a ready-enough video at timeout', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root, { loadTimeoutMs: 1000 });
    const ready = screen.preload(video('v1'));
    await vi.advanceTimersByTimeAsync(0);
    root.querySelectorAll('video')[0]!.dispatchEvent(new Event('canplay'));
    expect(await ready).toBe(true);

    const screen2 = new DomScreen(document.body.appendChild(document.createElement('div')), { loadTimeoutMs: 1000 });
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(3);
    const late = screen2.preload(video('v2'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await late).toBe(true);
  });

  it('falls back to load events when img.decode is missing', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: undefined });
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    const ready = screen.preload(image('old-tv'));
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    void ready.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    root.querySelectorAll('.layer img')[0]!.dispatchEvent(new Event('load'));
    expect(await ready).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomScreen } from '../src/dom-screen';
import { MseSession, mseSupported } from '../src/mse-sequence';
import { runPlayer, type PlayResult, type Screen } from '../src/player';
import type { Item, Manifest } from '../src/types';

const CODECS = 'avc1.640028, mp4a.40.2';
const AD_SECONDS = 15;

/** Minimal MediaSource: each appended ad adds 15 s to the timeline, as "sequence" mode would. */
class FakeSourceBuffer extends EventTarget {
  mode = 'segments';
  updating = false;
  timestampOffset = 0;
  appended: number[] = [];
  removed: [number, number][] = [];
  buffered = { length: 0, end: () => 0 };
  appendBuffer(bytes: ArrayBuffer) {
    this.appended.push(bytes.byteLength);
    this.updating = true;
    queueMicrotask(() => {
      this.timestampOffset += AD_SECONDS;
      this.updating = false;
      this.dispatchEvent(new Event('updateend'));
    });
  }
  remove(start: number, end: number) {
    this.removed.push([start, end]);
    queueMicrotask(() => this.dispatchEvent(new Event('updateend')));
  }
}
class FakeMediaSource extends EventTarget {
  static isTypeSupported = (t: string) => t.includes('avc1.640028');
  static last: FakeMediaSource;
  sb = new FakeSourceBuffer();
  constructor() {
    super();
    FakeMediaSource.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')));
  }
  addSourceBuffer() {
    return this.sb;
  }
}

const tvVideo = (id: string): Item => ({
  campaignId: `c-${id}`, kind: 'commercial', name: id, frequencyLevel: 'low',
  media: {
    id, url: `/api/media/${id}`, tvUrl: `/api/media/${id}/tv`, mediaType: 'video', mime: 'video/mp4', sha256: 's',
    sizeBytes: 10, durationMs: AD_SECONDS * 1000, displaySeconds: null,
  },
});

beforeEach(() => {
  vi.stubGlobal('MediaSource', FakeMediaSource);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:ms', revokeObjectURL: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(8))));
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('MseSession', () => {
  it('appends ads back to back and knows where each one sits on the timeline', async () => {
    expect(mseSupported(CODECS)).toBe(true);
    expect(mseSupported(undefined)).toBe(false);
    const session = new MseSession(document.createElement('video'), CODECS);
    const a = await session.append('a', new ArrayBuffer(4));
    const b = await session.append('b', new ArrayBuffer(4));
    expect(a).toMatchObject({ start: 0, end: 15 });
    expect(b).toMatchObject({ start: 15, end: 30 });
    expect(FakeMediaSource.last.sb.mode).toBe('sequence');
    expect(session.next('b')).toBe(b);
  });
});

describe('DomScreen with TV-optimized videos', () => {
  it('appends the next video to the one on screen and plays it on the same element', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root, { loadTimeoutMs: 50 });
    screen.setTvCodecs(CODECS);
    const videos = root.querySelectorAll('video');
    const playing = new Set<HTMLVideoElement>();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      playing.add(this as HTMLVideoElement);
      return Promise.resolve();
    });
    for (const v of videos) {
      Object.defineProperty(v, 'paused', { get: () => !playing.has(v) });
      Object.defineProperty(v, 'readyState', { value: 4 });
    }

    expect(await screen.preload(tvVideo('a'))).toBe(true);
    const first = screen.present(tvVideo('a'));
    await new Promise((r) => setTimeout(r, 700)); // transition
    expect(screen.canChain(tvVideo('a'), tvVideo('b'))).toBe(true);
    expect(await screen.preload(tvVideo('b'))).toBe(true);
    const element = [...videos].find((v) => v.getAttribute('src') === 'blob:ms')!;
    expect([...videos].filter((v) => v.getAttribute('src') === 'blob:ms')).toHaveLength(1); // one decoder only

    element.currentTime = 14.95;
    expect(await first).toBe('completed');
    const second = screen.present(tvVideo('b'));
    element.currentTime = 29.95;
    expect(await second).toBe('completed');
  });
});

describe('runPlayer with chainable videos', () => {
  it('keeps preloading during playback (no one-at-a-time wait) when videos can be chained', async () => {
    const log: string[] = [];
    const screen: Screen = {
      preload: vi.fn(async (i: Item) => (log.push(`preload ${i.media.id}`), true)),
      present: vi.fn(async (i: Item): Promise<PlayResult> => {
        log.push(`present ${i.media.id}`);
        await Promise.resolve();
        log.push(`end ${i.media.id}`);
        return 'completed';
      }),
      setTransition: vi.fn(),
      setMuted: vi.fn(),
      showWaiting: vi.fn(),
      freezeVideo: vi.fn(() => log.push('freeze')),
      setTvCodecs: vi.fn(),
      canChain: () => true,
    };
    const m: Manifest = {
      partner: { name: 'P', weights: { low: 1, medium: 2, high: 3 }, transition: 'fade', transitionMs: 600 },
      items: [tvVideo('a'), tvVideo('b')], generatedAt: 'x', tvCodecs: CODECS,
    };
    let n = 0;
    await runPlayer({ screen, manifest: () => m, sleep: async () => {}, running: () => n++ < 2 });
    expect(log.indexOf('preload b')).toBeLessThan(log.indexOf('end a'));
    expect(log).not.toContain('freeze');
    expect(screen.setTvCodecs).toHaveBeenCalledWith(CODECS);
  });
});

import type { PlayResult, Screen } from './player';
import { MseSession, mseSupported, type Segment } from './mse-sequence';
import type { Item, Transition } from './types';

/** Something that went wrong on this TV, sent to the panel for diagnosis. */
export interface ScreenIssue {
  kind: 'load_timeout' | 'load_error' | 'image_error' | 'play_rejected' | 'stalled' | 'video_error' | 'mse_error';
  mediaId?: string;
  detail?: string;
}

interface Layer {
  el: HTMLDivElement;
  video: HTMLVideoElement;
  img: HTMLImageElement;
  /** Set while the layer's video is fed by a MediaSource (TV-optimized ads appended back to back). */
  mse?: MseSession;
}

const MAX_PREFETCH_BYTES = 80 * 1024 * 1024;
const MAX_PREFETCHED = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, sleep(ms).then(() => fallback)]);

/** Two reusable layers: one on screen, one loading the next ad. */
export class DomScreen implements Screen {
  private readonly stage: HTMLDivElement;
  private readonly waiting: HTMLDivElement;
  private readonly layers: [Layer, Layer];
  private active = 1; // the first present() shows layer 0
  private transitionMs = 600;
  private freeAt: Promise<void> = Promise.resolve();
  private readonly loadTimeoutMs: number;
  private readonly stallTimeoutMs: number;
  private readonly onIssue: (issue: ScreenIssue) => void;
  /** mediaId → object URL of a video downloaded ahead (at most a couple, to spare the TV's memory). */
  private readonly prefetched = new Map<string, Promise<string | null>>();
  private tvCodecs: string | undefined;
  /** Where the last preloaded MediaSource ad sits; chained = appended to the video on screen (same layer). */
  private prepared: { layer: Layer; segment: Segment; chained: boolean } | null = null;

  constructor(
    root: HTMLElement,
    opts: { loadTimeoutMs?: number; stallTimeoutMs?: number; onIssue?: (issue: ScreenIssue) => void } = {},
  ) {
    this.onIssue = opts.onIssue ?? (() => undefined);
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 30_000;
    this.stallTimeoutMs = opts.stallTimeoutMs ?? 15_000;
    this.stage = document.createElement('div');
    this.stage.className = 'stage fade';
    root.appendChild(this.stage);
    this.layers = [this.makeLayer(), this.makeLayer()];
    this.waiting = document.createElement('div');
    this.waiting.className = 'waiting hidden';
    this.waiting.innerHTML =
      '<img class="brand-mark" src="/player/kraken-symbol.png" alt="" /><h1>Kraken Ads</h1><p>Aguardando campanhas…</p>';
    root.appendChild(this.waiting);
  }

  private makeLayer(): Layer {
    const el = document.createElement('div');
    el.className = 'layer';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    const img = document.createElement('img');
    img.alt = '';
    el.append(video, img);
    this.stage.appendChild(el);
    return { el, video, img };
  }

  setTransition(type: Transition, ms: number): void {
    this.transitionMs = type === 'cut' ? 0 : ms;
    this.stage.classList.remove('fade', 'slide', 'cut');
    this.stage.classList.add(type);
    this.stage.style.setProperty('--t', `${this.transitionMs}ms`);
  }

  setMuted(muted: boolean): void {
    for (const l of this.layers) l.video.muted = muted;
  }

  showWaiting(on: boolean): void {
    this.waiting.classList.toggle('hidden', !on);
  }

  setTvCodecs(codecs: string | undefined): void {
    this.tvCodecs = codecs;
  }

  /** True when `next` can be appended to the video now on screen, so it needs no second decoder. */
  canChain(current: Item, next: Item): boolean {
    return (
      mseSupported(this.tvCodecs) &&
      !!current.media.tvUrl &&
      !!next.media.tvUrl &&
      !!this.layers[this.active]!.mse?.usable
    );
  }

  /**
   * Downloads the TV copy and appends it to the layer's MediaSource, all within the load timeout. On failure the
   * buffer stops being used; if it is on screen it is left alone until its ad ends.
   */
  private async appendTo(layer: Layer, item: Item, onScreen: boolean): Promise<Segment | null> {
    const abort = new AbortController();
    const work = (async () => {
      const res = await fetch(item.media.tvUrl!, { credentials: 'same-origin', signal: abort.signal });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const segment = await layer.mse!.append(item.media.id, await res.arrayBuffer());
      if (!segment) throw new Error('append refused');
      return segment;
    })();
    try {
      const segment = await withTimeout(work, this.loadTimeoutMs * 2, null);
      if (!segment) throw new Error('timeout');
      return segment;
    } catch (err) {
      abort.abort();
      this.onIssue({ kind: 'mse_error', mediaId: item.media.id, detail: (err as Error).message });
      if (onScreen) layer.mse?.disable();
      else this.dropMse(layer);
      return null;
    }
  }

  private dropMse(layer: Layer): void {
    layer.mse?.destroy();
    layer.mse = undefined;
    this.releaseVideo(layer.video);
  }

  /** The video on screen is busy decoding (TVs have a single decoder): nothing else may load meanwhile. */
  private videoPlayingOnScreen(): boolean {
    const v = this.layers[this.active]!.video;
    return !!v.getAttribute('src') && !v.paused;
  }

  /** A paused video under an image on screen still holds the decoder: free it before loading another video. */
  private freeIdleDecoder(): void {
    const layer = this.layers[this.active]!;
    if (!layer.video.getAttribute('src') || !layer.video.paused) return;
    if (layer.mse) this.dropMse(layer);
    else this.releaseVideo(layer.video);
  }

  /** TV-optimized video through MediaSource: appended to the ad on screen when possible, else to the hidden layer. */
  private async preloadMse(item: Item): Promise<boolean> {
    const onScreen = this.layers[this.active]!;
    if (this.videoPlayingOnScreen()) {
      if (!onScreen.mse?.usable) return false; // never a second decoder: wait for the next turn
      const segment = await this.appendTo(onScreen, item, true);
      if (!segment) return false;
      this.prepared = { layer: onScreen, segment, chained: true };
      return true;
    }
    this.freeIdleDecoder();
    const layer = this.layers[1 - this.active]!;
    layer.img.removeAttribute('src');
    if (!layer.mse?.usable) {
      this.dropMse(layer);
      layer.mse = new MseSession(layer.video, this.tvCodecs!);
    }
    const segment = await this.appendTo(layer, item, false);
    if (!segment) return false;
    layer.video.currentTime = segment.start; // the playhead must sit on the new data for canplay to fire
    if (layer.video.readyState < 3) {
      await withTimeout(new Promise((r) => layer.video.addEventListener('canplay', r, { once: true })), this.loadTimeoutMs, null);
    }
    this.prepared = { layer, segment, chained: false };
    return true;
  }

  async preload(item: Item): Promise<boolean> {
    await this.freeAt; // never touch the layer that is still transitioning out
    this.prepared = null;
    const isVideo = item.media.mediaType === 'video';
    if (isVideo && item.media.tvUrl && mseSupported(this.tvCodecs)) {
      if (await this.preloadMse(item)) return true;
      if (this.videoPlayingOnScreen()) return false;
      // MediaSource refused it: fall back to the uploaded file, one video at a time.
    }
    if (isVideo) {
      if (this.videoPlayingOnScreen()) return false; // a second decoder would black out the screen
      this.freeIdleDecoder();
    }
    const layer = this.layers[1 - this.active]!;
    if (!isVideo && layer.mse?.usable) layer.img.removeAttribute('src');
    else this.release(layer);
    if (item.media.mediaType === 'image') {
      const img = layer.img;
      const loaded = new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      });
      img.src = item.media.url;
      // decode() also waits for decoding; older TV browsers only have load/error.
      const ready = img.decode ? img.decode().then(() => true, () => false) : loaded;
      const ok = await withTimeout(ready, this.loadTimeoutMs, false);
      img.onload = img.onerror = null;
      if (!ok) this.onIssue({ kind: 'image_error', mediaId: item.media.id });
      return ok;
    }
    const video = layer.video;
    let finish!: (ok: boolean) => void;
    const ready = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    let failedWithError = false;
    const onReady = () => finish(true);
    const onError = () => {
      failedWithError = true;
      finish(false);
    };
    // Some TV browsers fire canplay but never canplaythrough.
    video.addEventListener('canplay', onReady);
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('error', onError);
    const ahead = this.prefetched.get(item.media.id);
    const local = ahead ? await withTimeout(ahead, this.loadTimeoutMs, null) : null;
    video.src = local ?? item.media.url;
    video.load();
    const ok = await withTimeout(ready, this.loadTimeoutMs, false);
    video.removeEventListener('canplay', onReady);
    video.removeEventListener('canplaythrough', onReady);
    video.removeEventListener('error', onError);
    const usable = ok || video.readyState >= 3; // HAVE_FUTURE_DATA: enough to start
    if (!usable) {
      this.onIssue(
        failedWithError
          ? { kind: 'load_error', mediaId: item.media.id, detail: `code=${video.error?.code ?? '?'} ${video.error?.message ?? ''}`.trim() }
          : { kind: 'load_timeout', mediaId: item.media.id, detail: `readyState=${video.readyState} networkState=${video.networkState}` },
      );
    }
    return usable;
  }

  async present(item: Item): Promise<PlayResult> {
    const prepared = this.prepared?.segment.mediaId === item.media.id ? this.prepared : null;
    this.prepared = null;
    if (prepared?.chained) {
      // Already appended after the ad on screen: same layer, same decoder, no reload.
      const { layer, segment } = prepared;
      layer.mse?.skipBefore(segment);
      const t = layer.video.currentTime;
      if (t < segment.start - 0.25 || t > segment.end) layer.video.currentTime = segment.start;
      if (layer.video.paused) await layer.video.play().catch(() => undefined);
      return this.watchSegment(layer, segment);
    }
    const previous = this.active;
    const nextIndex = 1 - previous;
    const incoming = this.layers[nextIndex]!;
    const outgoing = this.layers[previous]!;
    // Lock synchronously: preload() must not touch the outgoing layer until the transition ends.
    let unlock!: () => void;
    this.freeAt = new Promise<void>((r) => {
      unlock = r;
    });
    this.active = nextIndex;

    const isVideo = item.media.mediaType === 'video';
    incoming.video.classList.toggle('show', isVideo);
    incoming.img.classList.toggle('show', !isVideo);
    const segment = isVideo && prepared?.layer === incoming ? prepared.segment : undefined;
    if (segment) incoming.mse?.skipBefore(segment);
    if (isVideo) {
      incoming.video.currentTime = segment ? segment.start : 0;
      try {
        await incoming.video.play();
      } catch (err) {
        this.onIssue({ kind: 'play_rejected', mediaId: item.media.id, detail: (err as Error)?.name ?? String(err) });
        this.active = previous; // the current ad stays on screen
        unlock();
        return 'failed';
      }
    }

    incoming.el.classList.remove('out');
    incoming.el.classList.add('on');
    outgoing.el.classList.remove('on');
    outgoing.el.classList.add('out');
    void sleep(this.transitionMs + 50).then(() => {
      outgoing.el.classList.remove('out');
      // Fully unload (not just pause): a paused video still holds the TV's only decoder. A MediaSource video is only
      // paused: the next TV-optimized ad will be appended to it.
      if (outgoing.mse?.usable) outgoing.video.pause();
      else if (outgoing.mse) this.dropMse(outgoing);
      else if (outgoing.video.getAttribute('src')) this.releaseVideo(outgoing.video);
      unlock();
    });

    if (!isVideo) {
      await sleep((item.media.displaySeconds ?? 10) * 1000);
      return 'completed';
    }
    if (segment) return this.watchSegment(incoming, segment);
    return this.watchVideo(incoming.video, item.media.id);
  }

  /** An ad inside a MediaSource ends when the playhead reaches its end (the stream itself goes on). */
  private watchSegment(layer: Layer, segment: Segment): Promise<PlayResult> {
    const video = layer.video;
    const report = this.onIssue;
    return new Promise((resolve) => {
      let lastTime = video.currentTime;
      let still = 0;
      const tick = setInterval(() => {
        if (video.currentTime >= segment.end - 0.12) return finish('completed');
        still = video.currentTime === lastTime ? still + 100 : 0;
        lastTime = video.currentTime;
        if (still >= this.stallTimeoutMs) {
          report({ kind: 'stalled', mediaId: segment.mediaId, detail: `mse at ${Math.round(video.currentTime)}s readyState=${video.readyState}` });
          finish('failed');
        }
      }, 100);
      const onError = () => {
        report({ kind: 'video_error', mediaId: segment.mediaId, detail: `mse code=${video.error?.code ?? '?'}` });
        finish('failed');
      };
      const finish = (result: PlayResult) => {
        clearInterval(tick);
        video.removeEventListener('error', onError);
        segment.played = true;
        layer.mse?.trimBefore(segment.start);
        resolve(result);
      };
      video.addEventListener('error', onError);
    });
  }

  private watchVideo(video: HTMLVideoElement, mediaId: string): Promise<PlayResult> {
    const report = this.onIssue;
    return new Promise((resolve) => {
      let lastTime = video.currentTime;
      const watchdog = setInterval(() => {
        if (video.currentTime === lastTime) {
          report({ kind: 'stalled', mediaId, detail: `at ${Math.round(video.currentTime)}s readyState=${video.readyState}` });
          finish('failed');
        }
        lastTime = video.currentTime;
      }, this.stallTimeoutMs);
      const onEnded = () => finish('completed');
      const onError = () => {
        report({ kind: 'video_error', mediaId, detail: `code=${video.error?.code ?? '?'}` });
        finish('failed');
      };
      function finish(result: PlayResult) {
        clearInterval(watchdog);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        resolve(result);
      }
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
    });
  }

  prefetch(item: Item): void {
    const { id, url, mediaType, sizeBytes } = item.media;
    if (mediaType !== 'video' || this.prefetched.has(id) || sizeBytes > MAX_PREFETCH_BYTES) return;
    const download = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    this.prefetched.set(id, download);
    while (this.prefetched.size > MAX_PREFETCHED) {
      const [oldId, oldUrl] = this.prefetched.entries().next().value!;
      this.prefetched.delete(oldId);
      void oldUrl.then((u) => {
        if (u && !this.layers.some((l) => l.video.getAttribute('src') === u)) URL.revokeObjectURL(u);
      });
    }
  }

  freezeVideo(): void {
    const layer = this.layers[this.active]!;
    const video = layer.video;
    if (!video.getAttribute('src')) return;
    if (layer.mse) {
      this.dropMse(layer);
      return;
    }
    try {
      // Same-origin video: copy its last frame into the layer's image so the screen is not black while the next
      // video loads, and the transition goes from that frame to the new video.
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0) {
        ctx.drawImage(video, 0, 0);
        layer.img.src = canvas.toDataURL('image/jpeg', 0.85);
        layer.img.classList.add('show');
        video.classList.remove('show');
      }
    } catch {
      // Some TV browsers cannot read video frames: a short dark gap instead.
    }
    this.releaseVideo(video);
  }

  private releaseVideo(video: HTMLVideoElement): void {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  /** Frees the decoder of a layer that is not on screen. */
  private release(layer: Layer): void {
    if (layer.mse) this.dropMse(layer);
    else this.releaseVideo(layer.video);
    layer.img.removeAttribute('src');
  }
}

import type { PlayResult, Screen } from './player';
import type { Item, Transition } from './types';

interface Layer {
  el: HTMLDivElement;
  video: HTMLVideoElement;
  img: HTMLImageElement;
}

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

  constructor(root: HTMLElement, opts: { loadTimeoutMs?: number; stallTimeoutMs?: number } = {}) {
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

  async preload(item: Item): Promise<boolean> {
    await this.freeAt; // never touch the layer that is still transitioning out
    const layer = this.layers[1 - this.active]!;
    this.release(layer);
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
      return ok;
    }
    const video = layer.video;
    let finish!: (ok: boolean) => void;
    const ready = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const onReady = () => finish(true);
    const onError = () => finish(false);
    // Some TV browsers fire canplay but never canplaythrough.
    video.addEventListener('canplay', onReady);
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('error', onError);
    video.src = item.media.url;
    video.load();
    const ok = await withTimeout(ready, this.loadTimeoutMs, false);
    video.removeEventListener('canplay', onReady);
    video.removeEventListener('canplaythrough', onReady);
    video.removeEventListener('error', onError);
    return ok || video.readyState >= 3; // HAVE_FUTURE_DATA: enough to start
  }

  async present(item: Item): Promise<PlayResult> {
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
    if (isVideo) {
      incoming.video.currentTime = 0;
      try {
        await incoming.video.play();
      } catch {
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
      // Fully unload (not just pause): a paused video still holds the TV's only decoder.
      if (outgoing.video.getAttribute('src')) this.releaseVideo(outgoing.video);
      unlock();
    });

    if (!isVideo) {
      await sleep((item.media.displaySeconds ?? 10) * 1000);
      return 'completed';
    }
    return this.watchVideo(incoming.video);
  }

  private watchVideo(video: HTMLVideoElement): Promise<PlayResult> {
    return new Promise((resolve) => {
      let lastTime = video.currentTime;
      const watchdog = setInterval(() => {
        if (video.currentTime === lastTime) finish('failed'); // stalled
        lastTime = video.currentTime;
      }, this.stallTimeoutMs);
      const onEnded = () => finish('completed');
      const onError = () => finish('failed');
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

  freeVideo(): void {
    const layer = this.layers[this.active]!;
    if (layer.video.getAttribute('src')) this.releaseVideo(layer.video);
  }

  private releaseVideo(video: HTMLVideoElement): void {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  /** Frees the decoder of a layer that is not on screen. */
  private release(layer: Layer): void {
    this.releaseVideo(layer.video);
    layer.img.removeAttribute('src');
  }
}

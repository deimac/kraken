/** Where an appended ad sits on the shared timeline of the MediaSource. */
export interface Segment {
  mediaId: string;
  start: number;
  end: number;
  played: boolean;
}

/** True when this browser can append the server's TV-optimized videos into one MediaSource buffer. */
export function mseSupported(codecs: string | undefined): codecs is string {
  return (
    !!codecs &&
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function' &&
    MediaSource.isTypeSupported(`video/mp4; codecs="${codecs}"`)
  );
}

const once = (target: EventTarget, type: string) =>
  new Promise<Event>((resolve) => target.addEventListener(type, resolve, { once: true }));

/**
 * One <video> fed by a MediaSource: ads are appended back to back ("sequence" mode), so a TV with a single video
 * decoder plays them one after another without reloading — no black frame between them. Requires every ad to
 * share codec, resolution and frame rate (the server's TV-optimized copies do).
 */
export class MseSession {
  readonly segments: Segment[] = [];
  private readonly mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly url: string;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly opened: Promise<boolean>;
  private broken = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly codecs: string,
  ) {
    this.mediaSource = new MediaSource();
    this.url = URL.createObjectURL(this.mediaSource);
    this.opened = once(this.mediaSource, 'sourceopen').then(() => {
      try {
        const sb = this.mediaSource.addSourceBuffer(`video/mp4; codecs="${this.codecs}"`);
        sb.mode = 'sequence';
        this.sourceBuffer = sb;
        return true;
      } catch {
        this.broken = true;
        return false;
      }
    });
    video.src = this.url;
  }

  get usable(): boolean {
    return !this.broken;
  }

  /** Appends one whole ad (init + fragments) after the previous one; null when the buffer refused it. */
  append(mediaId: string, bytes: ArrayBuffer): Promise<Segment | null> {
    const run = async (): Promise<Segment | null> => {
      if (!(await this.opened) || !this.sourceBuffer) return null;
      const sb = this.sourceBuffer;
      const start = this.segments.at(-1)?.end ?? 0;
      try {
        const done = Promise.race([once(sb, 'updateend').then(() => true), once(sb, 'error').then(() => false)]);
        sb.appendBuffer(bytes);
        if (!(await done)) throw new Error('append failed');
      } catch {
        this.broken = true;
        return null;
      }
      // In sequence mode the offset moves to the end of what was just appended.
      const end = sb.timestampOffset > start ? sb.timestampOffset : bufferedEnd(sb, start);
      const segment: Segment = { mediaId, start, end, played: false };
      this.segments.push(segment);
      return segment;
    };
    const result = this.chain.then(run, run);
    this.chain = result;
    return result;
  }

  /** The first appended copy of this ad that has not been shown yet. */
  next(mediaId: string): Segment | undefined {
    return this.segments.find((s) => s.mediaId === mediaId && !s.played);
  }

  /** Drops what is well behind the playhead, to spare the TV's memory. */
  trimBefore(time: number): void {
    const sb = this.sourceBuffer;
    const until = time - 10;
    if (!sb || until <= 0 || sb.updating) return;
    this.chain = this.chain.then(async () => {
      if (sb.updating) await once(sb, 'updateend');
      try {
        const done = once(sb, 'updateend');
        sb.remove(0, until);
        await done;
      } catch {
        // trimming is best effort
      }
    });
  }

  destroy(): void {
    URL.revokeObjectURL(this.url);
    this.broken = true;
  }
}

function bufferedEnd(sb: SourceBuffer, fallback: number): number {
  const b = sb.buffered;
  return b.length ? b.end(b.length - 1) : fallback;
}

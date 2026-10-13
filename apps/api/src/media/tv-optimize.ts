import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { and, eq, isNull, ne, notLike, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { media } from '../db/schema';
import type { LocalStorage } from '../storage/local';
import { probeMp4 } from './mp4';

/**
 * Codec string of every TV-optimized video: H.264 High 4.0 + AAC-LC. All of them share it (and resolution, frame
 * rate, timescales), so the player can append one after another into a single MediaSource buffer: TVs with a
 * single video decoder (Fire TV) then play back-to-back ads without a black gap.
 */
export const TV_CODECS = 'avc1.640028, mp4a.40.2';

const FFMPEG_TIMEOUT_MS = 5 * 60_000;

/** ffmpeg arguments: 1080p30, closed 2 s GOPs, AAC 48 kHz stereo (silence when the ad has no sound), fragmented. */
export function tvVideoArgs(input: string, output: string, hasAudio: boolean): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1,format=yuv420p',
    // A soundtrack shorter than the picture is padded with silence: -shortest must never cut the video.
    ...(hasAudio ? ['-af', 'apad'] : []),
    // Two threads: the VPS also serves the panel and the TVs while this runs.
    '-threads', '2',
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-preset', 'veryfast', '-crf', '21',
    '-bf', '0', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-x264-params', 'open-gop=0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-shortest',
    '-video_track_timescale', '90000',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', output,
  ];
}

export const posterArgs = (input: string, output: string) =>
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-q:v', '3', output];

function run(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop() ?? ''}`));
    });
  });
}

/** The ffmpeg binary to use, or null when it is not installed (videos then play as uploaded). */
export function findFfmpeg(candidate = process.env.FFMPEG_PATH || 'ffmpeg'): string | null {
  const r = spawnSync(candidate, ['-version'], { stdio: 'ignore' });
  return r.status === 0 ? candidate : null;
}

export interface TvOptimizer {
  /** Queues a video piece; the original keeps playing until the optimized version is ready. */
  enqueue(mediaId: string): void;
  /** Queues every video that was never optimized (e.g. uploaded before this feature). */
  backfill(): Promise<void>;
  /** Resolves when the queue is empty (tests). */
  idle(): Promise<void>;
}

/**
 * Encoding profile, part of each copy's file name. Bump it when tvVideoArgs changes in a way TVs depend on: copies of
 * an older profile are redone on startup. tv2: no B-frames (their delayed first frame left holes between ads).
 */
const TV_PROFILE = 'tv2';
const outdated = () => notLike(media.tvKey, `%.${TV_PROFILE}.%`);

/** One video at a time, in the background: the VPS also serves the panel and the TVs. */
export function createTvOptimizer(opts: { db: Db; storage: LocalStorage; ffmpeg: string; log: FastifyBaseLogger }): TvOptimizer {
  const { db, storage, ffmpeg, log } = opts;
  let chain: Promise<void> = Promise.resolve();
  const queued = new Set<string>();

  async function optimize(id: string) {
    const [row] = await db
      .select({ id: media.id, storageKey: media.storageKey, partnerId: media.partnerId, oldTvKey: media.tvKey })
      .from(media)
      .where(and(eq(media.id, id), eq(media.mediaType, 'video'), or(isNull(media.tvKey), outdated())));
    if (!row) return;
    const video = storage.tmpPath();
    const poster = storage.tmpPath();
    try {
      const source = storage.pathOf(row.storageKey);
      const { audioCodec } = await probeMp4(source);
      await run(ffmpeg, tvVideoArgs(source, video, audioCodec !== null));
      await run(ffmpeg, posterArgs(video, `${poster}.jpg`));
      const prefix = row.partnerId ?? 'institutional';
      // Versioned name: a re-optimized file gets a new URL, so TVs never keep a stale cached copy.
      const tvKey = `${prefix}/${id}.${TV_PROFILE}.${Date.now().toString(36)}.mp4`;
      const posterKey = `${prefix}/${id}.poster.jpg`;
      await storage.saveFrom(video, tvKey);
      await storage.saveFrom(`${poster}.jpg`, posterKey);
      await db.update(media).set({ tvKey, posterKey, tvError: null }).where(eq(media.id, id));
      if (row.oldTvKey) await storage.remove(row.oldTvKey).catch(() => undefined);
      log.info({ mediaId: id }, 'video optimized for TV');
    } catch (err) {
      log.warn({ err, mediaId: id }, 'video TV optimization failed');
      await db.update(media).set({ tvError: (err as Error).message.slice(0, 300) }).where(eq(media.id, id));
    } finally {
      await rm(video, { force: true });
      await rm(`${poster}.jpg`, { force: true });
    }
  }

  return {
    enqueue(id) {
      if (queued.has(id)) return;
      queued.add(id);
      chain = chain.then(() => optimize(id)).catch((err) => log.error({ err }, 'tv optimizer')).finally(() => queued.delete(id));
    },
    async backfill() {
      const rows = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.mediaType, 'video'),
            ne(media.status, 'removed'),
            or(and(isNull(media.tvKey), isNull(media.tvError)), outdated()),
          ),
        );
      for (const r of rows) this.enqueue(r.id);
    },
    idle: () => chain,
  };
}

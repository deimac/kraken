import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rm, stat, statfs } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import type { LocalStorage } from '../storage/local';
import { detectImageMime, isMp4 } from './detect';
import { probeMp4 } from './mp4';

export interface UploadLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
  /** Uploads are refused when the disk would drop below this much free space. */
  minFreeBytes: number;
  uploadsPerHour: number;
}

/** Route config limiting uploads per signed-in user. */
export function uploadRateLimit(limits: UploadLimits | undefined) {
  return {
    rateLimit: {
      max: limits?.uploadsPerHour ?? 30,
      timeWindow: '1 hour',
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
    },
  };
}

export type UploadOk = {
  ok: true;
  tmpPath: string;
  mediaType: 'image' | 'video';
  mime: string;
  ext: string;
  sizeBytes: number;
  sha256: string;
  durationMs: number | null;
  /** Name the file had on the uploader's device, for people to recognise the piece. */
  originalName: string | null;
};
export type UploadFail = { ok: false; status: 400 | 413 | 415 | 507; error: string };

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_CODECS = new Set(['avc1', 'avc3']);
const H264_PROFILES = new Set([66, 77, 100]); // Baseline, Main, High — what TV decoders handle
const MAX_H264_LEVEL = 51;

export async function receiveUpload(
  req: FastifyRequest,
  storage: LocalStorage,
  limits: UploadLimits,
): Promise<UploadOk | UploadFail> {
  if (!req.isMultipart()) return { ok: false, status: 400, error: 'file_required' };
  // Media shares the disk with Postgres: never let uploads fill it.
  const fs = await statfs(storage.root);
  if (fs.bavail * fs.bsize - limits.maxVideoBytes < limits.minFreeBytes) {
    return { ok: false, status: 507, error: 'storage_full' };
  }
  const part = await req.file({ limits: { fileSize: Math.max(limits.maxImageBytes, limits.maxVideoBytes), files: 1 } });
  if (!part) return { ok: false, status: 400, error: 'file_required' };

  const tmpPath = storage.tmpPath();
  const fail = async (status: UploadFail['status'], error: string): Promise<UploadFail> => {
    await rm(tmpPath, { force: true });
    return { ok: false, status, error };
  };

  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(part.file, hasher, createWriteStream(tmpPath));
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return fail(413, 'file_too_large');
    await rm(tmpPath, { force: true });
    throw err;
  }
  if (part.file.truncated) return fail(413, 'file_too_large');

  const { size } = await stat(tmpPath);
  const head = Buffer.alloc(16);
  const fh = await open(tmpPath, 'r');
  await fh.read(head, 0, 16, 0);
  await fh.close();
  const originalName = part.filename ? [...part.filename].filter((ch) => ch >= ' ').join('').trim().slice(0, 120) || null : null;
  const base = { ok: true as const, tmpPath, sizeBytes: size, sha256: hash.digest('hex'), originalName };

  const imageMime = detectImageMime(head);
  if (imageMime) {
    if (size > limits.maxImageBytes) return fail(413, 'file_too_large');
    return { ...base, mediaType: 'image', mime: imageMime, ext: IMAGE_EXT[imageMime]!, durationMs: null };
  }
  if (isMp4(head)) {
    if (size > limits.maxVideoBytes) return fail(413, 'file_too_large');
    try {
      const info = await probeMp4(tmpPath);
      const ok =
        info.durationMs > 0 &&
        info.videoCodec !== null &&
        VIDEO_CODECS.has(info.videoCodec) &&
        info.videoProfile !== null &&
        H264_PROFILES.has(info.videoProfile) &&
        info.videoLevel !== null &&
        info.videoLevel <= MAX_H264_LEVEL &&
        (info.width ?? 0) <= 3840 &&
        (info.height ?? 0) <= 2160 &&
        (info.audioCodec === null || info.audioCodec === 'mp4a');
      if (!ok) return fail(415, 'unsupported_media');
      return { ...base, mediaType: 'video', mime: 'video/mp4', ext: 'mp4', durationMs: info.durationMs };
    } catch {
      return fail(415, 'unsupported_media');
    }
  }
  return fail(415, 'unsupported_media');
}

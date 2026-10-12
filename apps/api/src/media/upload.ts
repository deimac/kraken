import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import type { LocalStorage } from '../storage/local';
import { detectImageMime, isMp4 } from './detect';
import { probeMp4 } from './mp4';

export interface UploadLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
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
  fields: Record<string, string>;
};
export type UploadFail = { ok: false; status: 400 | 413 | 415; error: string };

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_CODECS = new Set(['avc1', 'avc3']);

export async function receiveUpload(
  req: FastifyRequest,
  storage: LocalStorage,
  limits: UploadLimits,
): Promise<UploadOk | UploadFail> {
  if (!req.isMultipart()) return { ok: false, status: 400, error: 'file_required' };
  const part = await req.file({ limits: { fileSize: Math.max(limits.maxImageBytes, limits.maxVideoBytes), files: 1 } });
  if (!part) return { ok: false, status: 400, error: 'file_required' };

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(part.fields)) {
    const f = Array.isArray(value) ? value[0] : value;
    if (f && f.type === 'field') fields[name] = String(f.value);
  }

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
  const base = { ok: true as const, tmpPath, sizeBytes: size, sha256: hash.digest('hex'), fields };

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
        (info.audioCodec === null || info.audioCodec === 'mp4a');
      if (!ok) return fail(415, 'unsupported_media');
      return { ...base, mediaType: 'video', mime: 'video/mp4', ext: 'mp4', durationMs: info.durationMs };
    } catch {
      return fail(415, 'unsupported_media');
    }
  }
  return fail(415, 'unsupported_media');
}

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectImageMime, isMp4 } from '../src/media/detect';
import { probeMp4 } from '../src/media/mp4';
import { LocalStorage } from '../src/storage/local';
import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES, buildMp4 } from './helpers/mp4';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'midora-media-')); });
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('detect', () => {
  it('recognizes image signatures and mp4', () => {
    expect(detectImageMime(PNG_BYTES)).toBe('image/png');
    expect(detectImageMime(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectImageMime(WEBP_BYTES)).toBe('image/webp');
    expect(detectImageMime(Buffer.from('hello world, not an image'))).toBeNull();
    expect(isMp4(buildMp4())).toBe(true);
    expect(isMp4(PNG_BYTES)).toBe(false);
  });
});

describe('probeMp4', () => {
  const write = async (name: string, data: Buffer) => {
    const p = join(dir, name);
    await writeFile(p, data);
    return p;
  };

  it('reads duration and codecs with moov first or last', async () => {
    expect(await probeMp4(await write('a.mp4', buildMp4({ durationMs: 15000 })))).toEqual({
      durationMs: 15000, videoCodec: 'avc1', audioCodec: 'mp4a',
    });
    expect((await probeMp4(await write('b.mp4', buildMp4({ moovAtEnd: true, durationMs: 7000 })))).durationMs).toBe(7000);
  });

  it('reads version 1 mvhd', async () => {
    expect((await probeMp4(await write('v1.mp4', buildMp4({ mvhdVersion: 1, durationMs: 42000 })))).durationMs).toBe(42000);
  });

  it('reports HEVC and missing audio', async () => {
    expect(await probeMp4(await write('h.mp4', buildMp4({ video: 'hvc1', audio: null })))).toEqual({
      durationMs: 5000, videoCodec: 'hvc1', audioCodec: null,
    });
  });

  it('rejects files without moov and truncated boxes', async () => {
    await expect(probeMp4(await write('t.mp4', Buffer.from('not really an mp4 file at all')))).rejects.toThrow('invalid mp4');
    const full = buildMp4();
    await expect(probeMp4(await write('cut.mp4', full.subarray(0, 40)))).rejects.toThrow('invalid mp4');
  });
});

describe('LocalStorage', () => {
  it('moves temp files into keys, streams ranges and removes', async () => {
    const s = new LocalStorage(join(dir, 'store'));
    await s.init();
    const tmp = s.tmpPath();
    await writeFile(tmp, Buffer.from('0123456789'));
    await s.saveFrom(tmp, 'p1/m1.png');
    expect(await s.exists('p1/m1.png')).toBe(true);
    expect(await readdir(join(dir, 'store', 'tmp'))).toHaveLength(0);
    const chunks: Buffer[] = [];
    for await (const c of s.createReadStream('p1/m1.png', { start: 2, end: 5 })) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('2345');
    expect((await readFile(join(dir, 'store', 'p1/m1.png'))).toString()).toBe('0123456789');
    await s.remove('p1/m1.png');
    expect(await s.exists('p1/m1.png')).toBe(false);
  });

  it('refuses keys that escape the root', async () => {
    const s = new LocalStorage(join(dir, 'store2'));
    await s.init();
    expect(() => s.createReadStream('../../etc/passwd')).toThrow('invalid storage key');
  });
});

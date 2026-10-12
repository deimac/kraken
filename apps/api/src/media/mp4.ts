import { open } from 'node:fs/promises';

export interface Mp4Info {
  durationMs: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

interface Box {
  type: string;
  start: number; // payload start
  end: number; // payload end
}

const MAX_MOOV_BYTES = 50 * 1024 * 1024;
const invalid = () => new Error('invalid mp4');

function children(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (size < 8 || pos + size > end) throw invalid();
    boxes.push({ type, start: pos + 8, end: pos + size });
    pos += size;
  }
  return boxes;
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return children(buf, parent.start, parent.end).find((b) => b.type === type);
}

function path(buf: Buffer, parent: Box, types: string[]): Box | undefined {
  let current: Box | undefined = parent;
  for (const t of types) current = current && child(buf, current, t);
  return current;
}

function parseMoov(buf: Buffer): Mp4Info {
  const moov: Box = { type: 'moov', start: 0, end: buf.length };
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd) throw invalid();
  const version = buf[mvhd.start];
  const timescale = buf.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
  if (!timescale) throw invalid();

  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const trak of children(buf, moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const hdlr = path(buf, trak, ['mdia', 'hdlr']);
    const stsd = path(buf, trak, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!hdlr || !stsd || stsd.end - stsd.start < 16) continue;
    const handler = buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
    // stsd: version/flags(4) + entry_count(4), then first sample entry: size(4) + format(4)
    const codec = buf.toString('latin1', stsd.start + 12, stsd.start + 16);
    if (handler === 'vide' && !videoCodec) videoCodec = codec;
    if (handler === 'soun' && !audioCodec) audioCodec = codec;
  }
  return { durationMs: Math.round((duration * 1000) / timescale), videoCodec, audioCodec };
}

/** Reads duration and codecs from the moov box without loading media data. */
export async function probeMp4(filePath: string): Promise<Mp4Info> {
  const fh = await open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const header = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= size) {
      await fh.read(header, 0, 16, pos);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (boxSize < headerSize || pos + boxSize > size) throw invalid();
      if (type === 'moov') {
        if (boxSize > MAX_MOOV_BYTES) throw invalid();
        const moov = Buffer.alloc(boxSize - headerSize);
        await fh.read(moov, 0, moov.length, pos + headerSize);
        try {
          return parseMoov(moov);
        } catch {
          throw invalid();
        }
      }
      pos += boxSize;
    }
    throw invalid();
  } finally {
    await fh.close();
  }
}

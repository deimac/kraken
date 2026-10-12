const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export function box(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function trak(handler: 'vide' | 'soun', codec: string): Buffer {
  return box(
    'trak',
    box(
      'mdia',
      box('hdlr', u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)),
      box('minf', box('stbl', box('stsd', u32(0), u32(1), box(codec, Buffer.alloc(8))))),
    ),
  );
}

/** Minimal structurally valid MP4 (no real frames): enough for box parsing. */
export function buildMp4(
  opts: { durationMs?: number; video?: string; audio?: string | null; moovAtEnd?: boolean; mvhdVersion?: 0 | 1 } = {},
): Buffer {
  const { durationMs = 5000, video = 'avc1', audio = 'mp4a', moovAtEnd = false, mvhdVersion = 0 } = opts;
  const timescale = 1000;
  const mvhd =
    mvhdVersion === 0
      ? box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(durationMs), Buffer.alloc(80))
      : box(
          'mvhd',
          Buffer.from([1, 0, 0, 0]),
          Buffer.alloc(8),
          Buffer.alloc(8),
          u32(timescale),
          Buffer.from(BigInt(durationMs).toString(16).padStart(16, '0'), 'hex'),
          Buffer.alloc(80),
        );
  const moov = box('moov', mvhd, trak('vide', video), ...(audio ? [trak('soun', audio)] : []));
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomavc1', 'latin1'));
  const mdat = box('mdat', Buffer.alloc(2048, 7));
  return Buffer.concat(moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(64, 3),
]);

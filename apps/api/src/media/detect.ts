export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMime(head: Buffer): ImageMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function isMp4(head: Buffer): boolean {
  return head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
}

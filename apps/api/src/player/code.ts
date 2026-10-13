import { createHash, randomInt } from 'node:crypto';

// No 0/O, 1/I: easy to read on a TV and type with a remote. 16 characters ≈ 80 bits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A TV access code such as "K7QM-2XHB-9TRA-WD4N". */
export function generateTvCode(): string {
  const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/** Accepts the code as typed: any case, with or without dashes or spaces. */
export const normalizeTvCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Only the hash is stored, like session tokens. */
export const hashTvCode = (code: string) => createHash('sha256').update(normalizeTvCode(code)).digest('hex');

function randomBytes(n: number): Uint8Array {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint8Array(n));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** RFC 9562 UUIDv7 (time-ordered) without BigInt or crypto.randomUUID, for old TV browsers. */
export function uuidv7(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  const b = random(16);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  let hex = '';
  for (let i = 0; i < 16; i++) hex += (b[i]! + 0x100).toString(16).slice(1);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

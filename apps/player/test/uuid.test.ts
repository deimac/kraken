import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/uuid';

describe('uuidv7', () => {
  it('is a version 7, variant 10 UUID with the timestamp first', () => {
    const id = uuidv7(0x0190f0123456, (n) => new Uint8Array(n).fill(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.startsWith('0190f012-3456-7')).toBe(true);
  });

  it('sorts by time and does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});

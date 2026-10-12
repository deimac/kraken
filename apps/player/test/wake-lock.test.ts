import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScreenOn } from '../src/wake-lock';

afterEach(() => vi.unstubAllGlobals());

describe('keepScreenOn', () => {
  it('requests the wake lock right away and again when the page becomes visible', async () => {
    const request = vi.fn(async () => ({}));
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    keepScreenOn();
    expect(request).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does nothing where unsupported', () => {
    vi.stubGlobal('navigator', {});
    expect(() => keepScreenOn()).not.toThrow();
  });
});

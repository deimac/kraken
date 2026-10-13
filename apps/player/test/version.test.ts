import { describe, expect, it, vi } from 'vitest';
import { watchVersion } from '../src/version';

describe('watchVersion', () => {
  it('reloads once the server reports a different version than the one the TV started with', () => {
    const reload = vi.fn();
    const seen = watchVersion(reload);
    seen('abc');
    seen('abc');
    seen(undefined); // older servers send no version
    expect(reload).not.toHaveBeenCalled();
    seen('def');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

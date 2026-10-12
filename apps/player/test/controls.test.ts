import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountControls } from '../src/controls';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('controls', () => {
  it('appear on a remote key press, toggle sound and hide again', async () => {
    vi.useFakeTimers();
    const setMuted = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted, logout: vi.fn() });
    const bar = root.querySelector('.overlay') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(bar.classList.contains('hidden')).toBe(false);
    const sound = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Ativar som')!;
    sound.click();
    expect(setMuted).toHaveBeenCalledWith(false);
    expect(sound.textContent).toBe('Desativar som');
    vi.advanceTimersByTime(8000);
    expect(bar.classList.contains('hidden')).toBe(true);
  });

  it('requests a screen wake lock on first interaction when supported', async () => {
    const request = vi.fn(async () => ({ addEventListener: vi.fn() }));
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted: vi.fn(), logout: vi.fn() });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
  });

  it('logs out', async () => {
    const logout = vi.fn(async () => undefined);
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted: vi.fn(), logout });
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Sair')!.click();
    expect(logout).toHaveBeenCalled();
  });
});

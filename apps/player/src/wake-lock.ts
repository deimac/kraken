type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };

/** Keeps the TV from dimming or starting its screensaver while ads play. */
export function keepScreenOn(): void {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return;
  const request = () => {
    nav.wakeLock!.request('screen').catch(() => undefined);
  };
  request();
  // The lock is released whenever the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') request();
  });
}

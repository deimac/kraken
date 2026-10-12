const HIDE_AFTER_MS = 8000;

type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };

export function mountControls(root: HTMLElement, deps: { setMuted(muted: boolean): void; logout(): Promise<void> }) {
  const bar = document.createElement('div');
  bar.className = 'overlay hidden';
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };

  let muted = true;
  const sound = button('Ativar som', () => {
    muted = !muted;
    deps.setMuted(muted);
    sound.textContent = muted ? 'Ativar som' : 'Desativar som';
  });
  if (document.documentElement.requestFullscreen) {
    button('Tela cheia', () => void document.documentElement.requestFullscreen().catch(() => undefined));
  }
  button('Sair', () => void deps.logout());
  root.appendChild(bar);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeLockRequested = false;
  const nav = navigator as WakeLockNavigator;
  const requestWakeLock = () => {
    if (!nav.wakeLock) return;
    nav.wakeLock.request('screen').catch(() => undefined);
  };

  function show() {
    bar.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bar.classList.add('hidden'), HIDE_AFTER_MS);
    if (!wakeLockRequested) {
      wakeLockRequested = true;
      requestWakeLock();
    }
    if (!bar.contains(document.activeElement)) (bar.querySelector('button') as HTMLButtonElement).focus();
  }

  document.addEventListener('keydown', show);
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target as Node)) show();
  });
  // The wake lock is released when the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (wakeLockRequested && document.visibilityState === 'visible') requestWakeLock();
  });
  return { show };
}

import { api } from './api';
import { mountControls } from './controls';
import { DomScreen } from './dom-screen';
import { codeError, codeFromHash, loginWithCode, renderLogin } from './login';
import { createManifestClient } from './manifest';
import { runPlayer } from './player';
import { createPlayQueue, playEvent } from './queue';
import { isTvSession } from './session';
import './style.css';
import type { Manifest } from './types';
import { watchVersion } from './version';
import { keepScreenOn } from './wake-lock';

const root = document.getElementById('app')!;

async function start() {
  root.innerHTML = '';
  keepScreenOn();
  const screen = new DomScreen(root);
  screen.showWaiting(true);
  const seenVersion = watchVersion(() => location.reload());
  const fetchManifest = async () => {
    const m = await api<Manifest>('/api/player/manifest');
    seenVersion(m.version);
    return m;
  };
  const manifest = createManifestClient(fetchManifest, {
    onUnauthorized: () => location.reload(),
  });
  mountControls(root, {
    setMuted: (m) => screen.setMuted(m),
    logout: async () => {
      await api('/api/player/logout', { method: 'POST' }).catch(() => undefined);
      location.reload();
    },
  });
  const plays = createPlayQueue({
    send: (batch, sentAt) =>
      api<{ accepted: string[]; rejected: string[] }>('/api/player/plays', { method: 'POST', body: { plays: batch, sentAt } }),
  });
  const flush = () => void plays.flush();
  setInterval(flush, 30_000);
  window.addEventListener('online', flush);
  flush(); // plays left over from before a restart

  await manifest.start();
  await runPlayer({
    screen,
    manifest: () => manifest.current(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    running: () => true,
    // Only ads shown to the end count as insertions (spec §9).
    onPlayed: (item, result) => {
      if (result !== 'completed') return;
      plays.add(playEvent(item));
      if (plays.size() >= 50) flush();
    },
  });
}

async function boot() {
  // Opened from the panel's link: sign in with the code and drop it from the address bar.
  const code = codeFromHash(location.hash);
  let refused: { code: string; error: string } | undefined;
  if (code) {
    history.replaceState(null, '', location.pathname + location.search);
    if (!(await isTvSession())) await loginWithCode(code).catch((err) => (refused = { code, error: codeError(err) }));
  }
  if (!(await isTvSession())) await renderLogin(root, refused);
  await start();
}

void boot();

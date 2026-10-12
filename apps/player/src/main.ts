import { api } from './api';
import { mountControls } from './controls';
import { DomScreen } from './dom-screen';
import { renderLogin } from './login';
import { createManifestClient } from './manifest';
import { runPlayer } from './player';
import { createPlayQueue, playEvent } from './queue';
import { isTvSession } from './session';
import './style.css';
import type { Manifest } from './types';
import { keepScreenOn } from './wake-lock';

const root = document.getElementById('app')!;

async function start() {
  root.innerHTML = '';
  keepScreenOn();
  const screen = new DomScreen(root);
  screen.showWaiting(true);
  const manifest = createManifestClient(() => api<Manifest>('/api/player/manifest'), {
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
  if (!(await isTvSession())) await renderLogin(root);
  await start();
}

void boot();

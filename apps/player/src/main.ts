import { api } from './api';
import { mountControls } from './controls';
import { DomScreen } from './dom-screen';
import { renderLogin } from './login';
import { createManifestClient } from './manifest';
import { runPlayer } from './player';
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
  await manifest.start();
  await runPlayer({
    screen,
    manifest: () => manifest.current(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    running: () => true,
  });
}

async function boot() {
  if (!(await isTvSession())) await renderLogin(root);
  await start();
}

void boot();

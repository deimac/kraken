import { ApiError, api } from './api';
import { mountControls } from './controls';
import { DomScreen } from './dom-screen';
import { renderLogin } from './login';
import { createManifestClient } from './manifest';
import { runPlayer } from './player';
import './style.css';
import type { Manifest } from './types';

const root = document.getElementById('app')!;

async function isTvSession(): Promise<boolean> {
  try {
    const r = await api<{ user: { role: string } }>('/api/auth/me');
    return r.user.role === 'player';
  } catch (err) {
    if (err instanceof ApiError) return false;
    return true; // offline at boot: try to play with whatever the server gives later
  }
}

async function start() {
  root.innerHTML = '';
  const screen = new DomScreen(root);
  screen.showWaiting(true);
  const manifest = createManifestClient(() => api<Manifest>('/api/player/manifest'), {
    onUnauthorized: () => location.reload(),
  });
  mountControls(root, {
    setMuted: (m) => screen.setMuted(m),
    logout: async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
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

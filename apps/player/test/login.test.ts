import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLogin } from '../src/login';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function fill(user: string, pass: string) {
  (document.querySelector('input[name=user]') as HTMLInputElement).value = user;
  (document.querySelector('input[name=password]') as HTMLInputElement).value = pass;
  (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('TV login', () => {
  it('resolves after a TV account signs in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { role: 'player' } }), { status: 200 })));
    const root = document.body.appendChild(document.createElement('div'));
    const done = renderLogin(root);
    fill('tv@ironberg', 'senha-tv-123');
    await expect(done).resolves.toBeUndefined();
  });

  it('shows errors for wrong credentials and non-TV accounts', async () => {
    const responses = [
      new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 }),
      new Response(JSON.stringify({ user: { role: 'partner_user' } }), { status: 200 }),
      new Response(null, { status: 204 }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const root = document.body.appendChild(document.createElement('div'));
    void renderLogin(root);
    fill('tv@x', 'errada');
    await vi.waitFor(() => expect(root.textContent).toContain('Usuário ou senha incorretos.'));
    fill('g@a.com', 'senha-forte-1');
    await vi.waitFor(() => expect(root.textContent).toContain('Use a conta da TV'));
  });
});

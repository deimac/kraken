import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeFromHash, renderLogin, slugFromPath } from '../src/login';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function submit(code: string) {
  (document.querySelector('input[name=code]') as HTMLInputElement).value = code;
  (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('TV sign-in with the access code', () => {
  it('resolves once the code is accepted', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { role: 'player' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const root = document.body.appendChild(document.createElement('div'));
    const done = renderLogin(root);
    expect(root.querySelector('input[name=password]')).toBeNull();
    submit('k7qm-2xhb-9tra-wd4n');
    await expect(done).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/player/code-login');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'k7qm-2xhb-9tra-wd4n' });
  });

  it('explains a wrong code and too many attempts', async () => {
    const responses = [
      new Response(JSON.stringify({ error: 'invalid_code' }), { status: 401 }),
      new Response(JSON.stringify({ error: 'rate' }), { status: 429 }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const root = document.body.appendChild(document.createElement('div'));
    void renderLogin(root);
    submit('AAAA-BBBB-CCCC-DDDD');
    await vi.waitFor(() => expect(root.textContent).toContain('Código inválido'));
    submit('AAAA-BBBB-CCCC-DDDD');
    await vi.waitFor(() => expect(root.textContent).toContain('Muitas tentativas'));
  });

  it('shows why the code from the link was refused, with the code filled in', () => {
    vi.stubGlobal('fetch', vi.fn());
    const root = document.body.appendChild(document.createElement('div'));
    void renderLogin(root, { code: 'AAAA-BBBB-CCCC-DDDD', error: 'Código inválido ou expirado.' });
    expect((root.querySelector('input[name=code]') as HTMLInputElement).value).toBe('AAAA-BBBB-CCCC-DDDD');
    expect(root.textContent).toContain('Código inválido ou expirado.');
  });

  it('reads the code from the link the partner opened', () => {
    expect(codeFromHash('#K7QM-2XHB-9TRA-WD4N')).toBe('K7QM-2XHB-9TRA-WD4N');
    expect(codeFromHash('')).toBeNull();
    expect(codeFromHash('#x')).toBeNull();
    expect(codeFromHash('#%E0%A4%A')).toBeNull(); // malformed escape must not break the player
  });

  it('reads the establishment from a direct address like /player/academia-demo', () => {
    expect(slugFromPath('/player/academia-demo')).toBe('academia-demo');
    expect(slugFromPath('/player/Academia-Demo/')).toBe('academia-demo');
    expect(slugFromPath('/player/')).toBeNull();
    expect(slugFromPath('/player/index.html')).toBeNull();
  });
});

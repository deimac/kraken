import { ApiError, api } from './api';

/** The panel's link opens the player as /player/#CODE: take the code from the address. */
export function codeFromHash(hash: string): string | null {
  let code: string;
  try {
    code = decodeURIComponent(hash.replace(/^#/, '')).trim();
  } catch {
    return null; // malformed link: fall back to typing the code
  }
  return code.replace(/[^A-Za-z0-9]/g, '').length >= 8 ? code : null;
}

/** Direct address /player/<slug>: the establishment whose TV this is. */
export function slugFromPath(path: string): string | null {
  const m = /^\/player\/([a-z0-9-]+)\/?$/i.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}

/** Signs the TV in by its address alone (only when the partner turned direct access on). */
export const loginOpen = (slug: string) => api('/api/player/open-login', { method: 'POST', body: { slug } });

/** Signs the TV in with its access code; resolves when accepted. */
export const loginWithCode = (code: string) => api('/api/player/code-login', { method: 'POST', body: { code } });

/** Why a code was refused, in words for the TV screen. */
export function codeError(err: unknown): string {
  return err instanceof ApiError && err.status === 401
    ? 'Código inválido ou expirado. Gere um novo no painel, em Conta da TV.'
    : err instanceof ApiError && err.status === 429
      ? 'Muitas tentativas. Aguarde um pouco.'
      : 'Sem conexão. Tente de novo.';
}

export function renderLogin(root: HTMLElement, initial: { code?: string; error?: string } = {}): Promise<void> {
  root.innerHTML = `
    <div class="login">
      <img class="brand-mark" src="/player/kraken-symbol.png" alt="" />
      <h1>Kraken Ads</h1>
      <form>
        <label>Código da TV<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required /></label>
        <p class="hint">Gere o código no painel do estabelecimento, em Conta da TV.</p>
        <p class="error" role="alert"></p>
        <button type="submit">Entrar</button>
      </form>
    </div>`;
  const form = root.querySelector('form')!;
  const error = root.querySelector('.error')!;
  const input = root.querySelector('input[name=code]') as HTMLInputElement;
  input.value = initial.code ?? '';
  error.textContent = initial.error ?? '';
  input.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const code = (form.elements.namedItem('code') as HTMLInputElement).value;
      try {
        await loginWithCode(code);
        resolve();
      } catch (err) {
        error.textContent = codeError(err);
      }
    });
  });
}

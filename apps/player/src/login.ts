import { ApiError, api } from './api';

export function renderLogin(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="login">
      <img class="brand-mark" src="/player/kraken-symbol.png" alt="" />
      <h1>Kraken Ads</h1>
      <form>
        <label>Usuário<input name="user" autocomplete="username" required /></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required /></label>
        <p class="error" role="alert"></p>
        <button type="submit">Entrar</button>
      </form>
    </div>`;
  const form = root.querySelector('form')!;
  const error = root.querySelector('.error')!;
  (root.querySelector('input[name=user]') as HTMLInputElement).focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const email = (form.elements.namedItem('user') as HTMLInputElement).value;
      const password = (form.elements.namedItem('password') as HTMLInputElement).value;
      try {
        await api('/api/player/login', { method: 'POST', body: { email, password } });
        resolve();
      } catch (err) {
        error.textContent =
          err instanceof ApiError && err.status === 401
            ? 'Usuário ou senha incorretos.'
            : err instanceof ApiError && err.code === 'not_tv_account'
              ? 'Use a conta da TV (tv@seu-estabelecimento), criada em Conta da TV no painel.'
            : err instanceof ApiError && err.status === 429
              ? 'Muitas tentativas. Aguarde um pouco.'
              : 'Sem conexão. Tente de novo.';
      }
    });
  });
}

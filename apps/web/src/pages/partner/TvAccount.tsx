import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import { Field, Notice, PageHeader } from '../../ui';

export function TvAccount() {
  const [login, setLogin] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partner: { slug: string } }>('/api/partner')
      .then((r) => setLogin(`tv@${r.partner.slug}`))
      .catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ login: string }>('/api/partner/player-account', { method: 'PUT', body: { password } });
      setLogin(r.login);
      setPassword('');
      setMsg({ kind: 'ok', text: 'Senha definida. As TVs conectadas foram desconectadas e precisam entrar com a nova senha.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Conta da TV" />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <p>Na TV, abra o navegador no endereço do Midora seguido de <strong>/player</strong> e entre com:</p>
        <p>Usuário: <strong>{login ?? '…'}</strong></p>
        <p className="muted">Trocar a senha desconecta todas as TVs deste estabelecimento.</p>
        <form className="form" onSubmit={save}>
          <Field label="Nova senha da TV">
            <input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Definir senha</button></div>
        </form>
      </div>
    </>
  );
}

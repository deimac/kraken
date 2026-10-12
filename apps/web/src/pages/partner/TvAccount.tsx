import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Transition } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

interface PartnerTv {
  slug: string;
  transition: Transition;
  transitionMs: number;
}

export function TvAccount() {
  const [login, setLogin] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [transition, setTransition] = useState<Transition>('fade');
  const [transitionMs, setTransitionMs] = useState(600);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partner: PartnerTv }>('/api/partner')
      .then((r) => {
        setLogin(`tv@${r.partner.slug}`);
        setTransition(r.partner.transition);
        setTransitionMs(r.partner.transitionMs);
      })
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

  async function saveTransition(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/partner/settings', { method: 'PATCH', body: { transition, transitionMs } });
      setMsg({ kind: 'ok', text: 'Transição salva. As TVs aplicam em até 5 minutos.' });
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
        <p>Na TV, abra o navegador no endereço do Kraken Ads seguido de <strong>/player</strong> e entre com:</p>
        <p>Usuário: <strong>{login ?? '…'}</strong></p>
        <p className="muted">Trocar a senha desconecta todas as TVs deste estabelecimento.</p>
        <form className="form" onSubmit={save}>
          <Field label="Nova senha da TV">
            <input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Definir senha</button></div>
        </form>
      </div>
      <div className="card">
        <h2>Transições</h2>
        <form className="form" onSubmit={saveTransition}>
          <Field label="Transição entre anúncios">
            <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
              <option value="fade">Esmaecer</option>
              <option value="slide">Deslizar</option>
              <option value="cut">Corte seco</option>
            </select>
          </Field>
          <Field label="Duração">
            <select value={String(transitionMs)} onChange={(e) => setTransitionMs(Number(e.target.value))} disabled={transition === 'cut'}>
              <option value="300">0,3 s</option>
              <option value="600">0,6 s</option>
              <option value="1000">1 s</option>
              <option value="1500">1,5 s</option>
              <option value="2000">2 s</option>
            </select>
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Salvar transição</button></div>
        </form>
      </div>
    </>
  );
}

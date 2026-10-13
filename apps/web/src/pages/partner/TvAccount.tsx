import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Transition } from '../../types';
import { ConfirmDialog, Field, Notice, PageHeader } from '../../ui';

interface PartnerTv {
  slug: string;
  transition: Transition;
  transitionMs: number;
  tvCodeSet?: boolean;
  playerOpen?: boolean;
}

export function TvAccount() {
  const [transition, setTransition] = useState<Transition>('fade');
  const [transitionMs, setTransitionMs] = useState(600);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeSet, setCodeSet] = useState(false);
  const [slug, setSlug] = useState('');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; link: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const closeRevoke = useCallback(() => setRevoking(false), []);

  useEffect(() => {
    api<{ partner: PartnerTv }>('/api/partner')
      .then((r) => {
        setTransition(r.partner.transition);
        setTransitionMs(r.partner.transitionMs);
        setCodeSet(Boolean(r.partner.tvCodeSet));
        setSlug(r.partner.slug);
        setOpen(Boolean(r.partner.playerOpen));
      })
      .catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  }, []);

  async function toggleOpen(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ partner: PartnerTv }>('/api/partner/settings', { method: 'PATCH', body: { playerOpen: next } });
      setOpen(Boolean(r.partner.playerOpen));
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function generateCode() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ code: string; path: string; expiresAt: string }>('/api/partner/player-code', { method: 'POST' });
      setCode({ code: r.code, link: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt });
      setCodeSet(true);
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await api('/api/partner/player-sessions/revoke', { method: 'POST' });
      setCode(null);
      setCodeSet(false);
      setMsg({ kind: 'ok', text: 'Todas as TVs foram desconectadas. Gere um código novo para conectar de novo.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setRevoking(false);
      setBusy(false);
    }
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => setMsg({ kind: 'ok', text: 'Copiado.' }));

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
        <h2>Acesso direto</h2>
        <label className="check">
          <input type="checkbox" checked={open} disabled={busy} onChange={(e) => toggleOpen(e.target.checked)} />
          Acesso direto: a TV entra só abrindo o endereço, sem código
        </label>
        {open && slug && (
          <div className="tv-code-link" style={{ marginTop: 8 }}>
            <code>{`${window.location.origin}/player/${slug}`}</code>
            <button className="btn" type="button" onClick={() => copy(`${window.location.origin}/player/${slug}`)}>Copiar endereço</button>
          </div>
        )}
        <p className="muted">
          Se este for o único estabelecimento com acesso direto, basta abrir <strong>{window.location.origin}/player</strong>.
          Prático para testes e para digitar com o controle remoto. Enquanto estiver ligado, qualquer pessoa com o endereço pode
          abrir o player deste estabelecimento; desligue quando terminar de configurar as TVs.
        </p>
      </div>
      <div className="card">
        <h2>Conectar uma TV com código</h2>
        <p>
          Na TV, abra o navegador no link de acesso — ou abra <strong>{window.location.origin}/player</strong> e digite o código.
          Não é preciso usuário nem senha.
        </p>
        {code ? (
          <div className="tv-code">
            <div className="tv-code-value">{code.code}</div>
            <div className="tv-code-link">
              <code>{code.link}</code>
              <button className="btn" type="button" onClick={() => copy(code.link)}>Copiar link</button>
              <button className="btn" type="button" onClick={() => copy(code.code)}>Copiar código</button>
            </div>
            <p className="muted">
              Vale até {new Date(code.expiresAt).toLocaleString('pt-BR')} e não é mostrado de novo. TVs já conectadas continuam funcionando.
            </p>
          </div>
        ) : (
          codeSet && <p className="muted">Há um código de acesso válido. Gere um novo se precisar conectar outra TV e não tiver o código anotado.</p>
        )}
        <button className="btn btn-primary" type="button" disabled={busy} onClick={generateCode}>
          {codeSet ? 'Gerar novo código' : 'Gerar código de acesso'}
        </button>
      </div>
      <div className="card">
        <h2>TVs conectadas</h2>
        <p className="muted">Se um código vazou ou uma TV saiu do estabelecimento, desconecte todas e conecte de novo com um código novo.</p>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => setRevoking(true)}>Desconectar todas as TVs</button>
      </div>
      <ConfirmDialog
        open={revoking}
        title="Desconectar todas as TVs"
        confirmLabel="Desconectar"
        danger
        busy={busy}
        onCancel={closeRevoke}
        onConfirm={revoke}
      >
        As TVs param de exibir os anúncios até entrarem de novo com um código novo.
      </ConfirmDialog>
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

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import { ConfirmDialog, Notice, PageHeader } from '../../ui';

interface TvEvent { kind: string; detail?: string; at: string; userAgent: string | null }

const ISSUE_LABEL: Record<string, string> = {
  load_timeout: 'Vídeo não carregou a tempo',
  load_error: 'Erro ao carregar o vídeo',
  image_error: 'Imagem não carregou',
  play_rejected: 'A TV recusou reproduzir o vídeo',
  stalled: 'Vídeo travou durante a exibição',
  video_error: 'Erro durante o vídeo',
};

/** Recent problems reported by the partner's TVs (kept by the server until it restarts). */
function TvDiagnostics() {
  const [events, setEvents] = useState<TvEvent[] | null>(null);
  const load = useCallback(() => {
    api<{ events: TvEvent[] }>('/api/partner/tv-events').then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, []);
  useEffect(load, [load]);
  return (
    <div className="card">
      <div className="section-head">
        <h2>Diagnóstico da TV</h2>
        <button className="btn" type="button" onClick={load}>Atualizar</button>
      </div>
      {events === null ? (
        <p className="muted">Carregando…</p>
      ) : events.length === 0 ? (
        <p className="muted">Nenhum problema relatado pelas TVs.</p>
      ) : (
        <>
          {events[0]?.userAgent && <p className="muted">Navegador da TV: {events[0].userAgent}</p>}
          <div className="list">
            {events.slice(0, 20).map((e, i) => (
              <div className="row" key={i}>
                <div className="row-main">
                  <div>{ISSUE_LABEL[e.kind] ?? e.kind}</div>
                  <div className="row-sub">{new Date(e.at).toLocaleString('pt-BR')}{e.detail ? ` · ${e.detail}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface PartnerTv {
  slug: string;
  tvCodeSet?: boolean;
  playerOpen?: boolean;
}

export function TvAccount() {
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

  return (
    <>
      <PageHeader title="Conta da TV" />
      <p className="muted">
        Transição, frequência de atualização e ordem dos anúncios ficam em <Link to="/parceiro/configuracoes">Configurações</Link>.
      </p>
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
      <TvDiagnostics />
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
    </>
  );
}

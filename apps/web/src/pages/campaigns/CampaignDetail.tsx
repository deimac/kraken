import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay } from '../../format';
import { errorMessage } from '../../messages';
import type { CampaignDetail as Detail } from '../../types';
import { Badge, Field, Notice, PageHeader } from '../../ui';

const ACTION_LABEL = {
  submitted: 'Enviada para aprovação',
  approved: 'Aprovada',
  changes_requested: 'Correção pedida',
  cancelled: 'Cancelada',
} as const;

export function CampaignDetail({ base }: { base: '/parceiro' | '/anunciante' }) {
  const { id } = useParams();
  const isPartner = base === '/parceiro';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState('10');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(
    () =>
      api<Detail>(`/api/campaigns/${id}`)
        .then(setDetail)
        .catch((e) => setMsg({ kind: 'error', text: errorMessage(e) })),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // One request at a time, even on double clicks.
  async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
      if (ok) setMsg({ kind: 'ok', text: ok });
      return true;
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!detail) return msg ? <Notice kind="error">{msg.text}</Notice> : <div className="muted">Carregando…</div>;
  const { campaign: c, media, reviews } = detail;
  const editable = c.status === 'draft' || c.status === 'changes_requested';
  const lastRequest = [...reviews].reverse().find((r) => r.action === 'changes_requested');

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setMsg({ kind: 'error', text: 'Escolha um arquivo.' });
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const query = file.type.startsWith('image/') ? `?displaySeconds=${encodeURIComponent(seconds)}` : '';
    if (await run(() => api(`/api/campaigns/${c.id}/media${query}`, { method: 'POST', form }), 'Arquivo enviado.')) setFile(null);
  }

  return (
    <>
      <PageHeader title={c.name} action={<Badge status={c.effectiveStatus} />} />
      <p className="muted" style={{ marginTop: -12 }}>
        <Link to={`${base}/campanhas`}>Voltar para campanhas</Link>
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {c.status === 'changes_requested' && lastRequest?.reason && (
        <Notice kind="info">Correção pedida pelo parceiro: {lastRequest.reason}</Notice>
      )}
      <div className="card">
        <p>
          {isPartner && c.advertiserName ? <>{c.advertiserName} · </> : null}
          {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()}
        </p>
        {media ? (
          media.mediaType === 'image' ? (
            <img className="preview" src={`/api/media/${media.id}`} alt={`Anúncio ${c.name}`} />
          ) : (
            <video className="preview" src={`/api/media/${media.id}`} controls muted preload="metadata" />
          )
        ) : (
          <p className="muted">Nenhum arquivo enviado ainda.</p>
        )}
        {media && (
          <p className="muted">
            {media.mediaType === 'image'
              ? `Imagem · ${media.displaySeconds}s na tela`
              : `Vídeo · ${Math.round((media.durationMs ?? 0) / 1000)}s`}
          </p>
        )}
      </div>

      {editable && (
        <div className="card">
          <h2>{media ? 'Trocar arquivo' : 'Enviar arquivo'}</h2>
          <form className="form" onSubmit={upload}>
            <Field label="Arquivo">
              <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Segundos na tela (imagens)">
              <input type="number" min={1} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </Field>
            <p className="muted">Imagens JPEG, PNG ou WebP. Vídeos MP4 (H.264).</p>
            <div><button className="btn" type="submit" disabled={busy}>Enviar arquivo</button></div>
          </form>
        </div>
      )}

      <div className="actions" style={{ marginBottom: 16 }}>
        {editable && (
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => run(() => api(`/api/campaigns/${c.id}/submit`, { method: 'POST' }), 'Campanha enviada para aprovação.')}
          >
            Enviar para aprovação
          </button>
        )}
        {isPartner && c.status === 'pending_review' && (
          <>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() => run(() => api(`/api/campaigns/${c.id}/approve`, { method: 'POST' }), 'Campanha aprovada.')}
            >
              Aprovar
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => setAsking(true)}>
              Pedir correção
            </button>
          </>
        )}
        {isPartner && c.status !== 'cancelled' && (
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy}
            onClick={() =>
              window.confirm('Cancelar esta campanha? Ela sai da rotação.') &&
              run(() => api(`/api/campaigns/${c.id}/cancel`, { method: 'POST' }), 'Campanha cancelada.')
            }
          >
            Cancelar campanha
          </button>
        )}
      </div>

      {asking && (
        <div className="card">
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(
                () => api(`/api/campaigns/${c.id}/request-changes`, { method: 'POST', body: { reason } }),
                'Pedido de correção enviado.',
              );
              if (ok) {
                setAsking(false);
                setReason('');
              }
            }}
          >
            <Field label="O que precisa ser corrigido">
              <textarea rows={3} minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <div><button className="btn btn-primary" type="submit" disabled={busy}>Enviar pedido de correção</button></div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Histórico</h2>
        {reviews.length === 0 ? (
          <p className="muted">Sem movimentações ainda.</p>
        ) : (
          <ul className="timeline">
            {reviews.map((r, i) => (
              <li key={i}>
                <strong>{ACTION_LABEL[r.action]}</strong> · {new Date(r.createdAt).toLocaleString('pt-BR')}
                {r.reason ? <div className="muted">{r.reason}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

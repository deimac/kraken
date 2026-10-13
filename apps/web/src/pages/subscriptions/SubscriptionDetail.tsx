import {
  IconCash, IconChartBar, IconCheck, IconPhoto, IconPlayerPause, IconPlayerPlay, IconTrash, IconUpload, IconVideo, IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { PIECE_STATUS_LABEL, formatDate, formatPlanPrice, lastDay, pieceName } from '../../format';
import { errorMessage } from '../../messages';
import type { CampaignDetail, Piece } from '../../types';
import { Badge, ConfirmDialog, EmptyState, Field, IconButton, Notice, PageHeader, StatCard } from '../../ui';
import type { Base } from './SubscriptionList';

const EVENT_LABEL: Record<string, string> = {
  created: 'Assinatura criada',
  paused: 'Pausada',
  resumed: 'Colocada no ar',
  cancelled: 'Cancelada',
  payment: 'Pagamento atualizado',
  piece_added: 'Peça publicada',
  piece_submitted: 'Peça enviada para aprovação',
  piece_approved: 'Peça aprovada',
  piece_rejected: 'Peça recusada',
  piece_removed: 'Peça removida',
  submitted: 'Enviada para aprovação',
  approved: 'Aprovada',
  changes_requested: 'Correção pedida',
};

type Dialog = { kind: 'reject' | 'remove'; piece: Piece } | { kind: 'cancel' } | null;

export function SubscriptionDetail({ base }: { base: Base }) {
  const { id } = useParams();
  const isPartner = base === '/parceiro';
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [uploads, setUploads] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [seconds, setSeconds] = useState('10');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(
    () => api<CampaignDetail>(`/api/campaigns/${id}`).then(setData).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) })),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // One request at a time, even on double clicks.
  async function run(fn: () => Promise<unknown>, ok?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
      if (ok) setMsg({ kind: 'ok', text: ok });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const closeDialog = useCallback(() => {
    setDialog(null);
    setReason('');
  }, []);

  async function sendFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setUploads([]);
    const results: { name: string; ok: boolean; text: string }[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const query = file.type.startsWith('image/') && seconds.trim() ? `?displaySeconds=${encodeURIComponent(seconds.trim())}` : '';
      try {
        await api(`/api/campaigns/${id}/pieces${query}`, { method: 'POST', form });
        results.push({ name: file.name, ok: true, text: 'enviado' });
      } catch (err) {
        results.push({ name: file.name, ok: false, text: errorMessage(err) });
      }
      setUploads([...results]);
    }
    await load();
    busyRef.current = false;
    setBusy(false);
  }

  if (!data) return msg ? <Notice kind="error">{msg.text}</Notice> : <div className="muted">Carregando…</div>;
  const { campaign: c, plan, pieces, usage, reviews, totalPlays } = data;
  const open = c.status !== 'cancelled';
  const pieceById = new Map(pieces.map((p) => [p.id, p]));

  const canRemove = (p: Piece) => (isPartner ? true : p.status === 'pending_review' || p.status === 'rejected');

  return (
    <>
      <PageHeader title={c.name} action={<Badge status={c.effectiveStatus} />} />
      <p className="muted" style={{ marginTop: -12 }}>
        {[isPartner ? c.advertiserName : null, c.planName, `${formatDate(c.startsAt)} a ${lastDay(c.endsAt)}`].filter(Boolean).join(' · ')}
        {' · '}
        <Link to={`${base}/assinaturas`}>Voltar para assinaturas</Link>
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {c.status === 'paused' && (
        <Notice kind="info">
          {isPartner ? 'Pausada: as peças não aparecem nas TVs até você reativar.' : 'Aguardando o estabelecimento colocar esta assinatura no ar.'}
        </Notice>
      )}

      {isPartner && open && (
        <div className="actions" style={{ marginBottom: 16 }}>
          {c.status === 'active' ? (
            <IconButton icon={<IconPlayerPause size={16} />} label="Pausar" disabled={busy} onClick={() => run(() => api(`/api/campaigns/${c.id}/pause`, { method: 'POST' }))} />
          ) : (
            <IconButton icon={<IconPlayerPlay size={16} />} label="Colocar no ar" className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/api/campaigns/${c.id}/resume`, { method: 'POST' }))} />
          )}
          <IconButton
            icon={<IconCash size={16} />}
            label={c.paymentStatus === 'paid' ? 'Marcar como pendente' : 'Marcar como pago'}
            disabled={busy}
            onClick={() =>
              run(() => api(`/api/campaigns/${c.id}/payment`, { method: 'PATCH', body: { paymentStatus: c.paymentStatus === 'paid' ? 'pending' : 'paid' } }))
            }
          />
          <IconButton icon={<IconX size={16} />} label="Cancelar assinatura" className="btn btn-danger" disabled={busy} onClick={() => setDialog({ kind: 'cancel' })} />
        </div>
      )}

      <div className="stats">
        <StatCard icon={<IconChartBar size={20} />} label="Inserções" value={totalPlays} />
        {plan && <StatCard icon={<IconVideo size={20} />} label="Vídeos" value={`${usage.videos}/${plan.maxVideos}`} hint={`até ${plan.maxVideoSeconds} s cada`} />}
        {plan && <StatCard icon={<IconPhoto size={20} />} label="Imagens" value={`${usage.images}/${plan.maxImages}`} />}
        {isPartner && plan && (
          <StatCard
            icon={<IconCash size={20} />}
            label="Valor"
            value={formatPlanPrice(c.priceCents, plan.periodMonths)}
            hint={c.paymentStatus === 'paid' ? 'Pago' : 'Pagamento pendente'}
          />
        )}
      </div>

      <div className="section-head">
        <h2>Peças</h2>
        {open && (
          <div className="actions">
            <Field label="Segundos por imagem">
              <input type="number" min={1} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} style={{ width: 90 }} />
            </Field>
            <label className={`btn btn-primary${busy ? ' is-busy' : ''}`}>
              <IconUpload size={16} />
              Enviar peças
              <input className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={sendFiles} disabled={busy} />
            </label>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {isPartner ? 'As peças que você envia entram no ar na hora.' : 'As peças que você enviar passam pela aprovação do estabelecimento.'}{' '}
        Imagens JPEG, PNG ou WebP; vídeos MP4 (H.264).
      </p>
      {uploads.length > 0 && (
        <ul className="upload-results">
          {uploads.map((u, i) => (
            <li key={i} className={u.ok ? 'ok' : 'error'}>{u.name}: {u.text}</li>
          ))}
        </ul>
      )}
      <div className="piece-grid">
        {pieces.map((p) => {
          const label = pieceName(p);
          return (
            <div className={`piece piece-${p.status}`} key={p.id}>
              {p.mediaType === 'image' ? (
                <img src={`/api/media/${p.id}`} alt={label} loading="lazy" />
              ) : (
                <video src={`/api/media/${p.id}`} muted controls preload="metadata" />
              )}
              <div className="piece-body">
                <strong title={label}>{label}</strong>
                <span className="muted">
                  {p.mediaType === 'image' ? `Imagem · ${p.displaySeconds} s na tela` : `Vídeo · ${Math.round((p.durationMs ?? 0) / 1000)} s`}
                </span>
                <span className={`chip chip-${p.status}`}>{PIECE_STATUS_LABEL[p.status]}</span>
                {p.status === 'rejected' && p.reviewReason && <span className="muted">Motivo: {p.reviewReason}</span>}
                <div className="actions">
                  {isPartner && p.status === 'pending_review' && (
                    <>
                      <IconButton icon={<IconCheck size={16} />} label="Aprovar" aria-label={`Aprovar ${label}`} className="btn btn-primary" disabled={busy}
                        onClick={() => run(() => api(`/api/campaigns/${c.id}/pieces/${p.id}/approve`, { method: 'POST' }), `${label} aprovada.`)} />
                      <IconButton icon={<IconX size={16} />} label="Recusar" aria-label={`Recusar ${label}`} disabled={busy} onClick={() => setDialog({ kind: 'reject', piece: p })} />
                    </>
                  )}
                  {open && canRemove(p) && (
                    <IconButton icon={<IconTrash size={16} />} label="Remover" aria-label={`Remover ${label}`} className="btn btn-danger" disabled={busy}
                      onClick={() => setDialog({ kind: 'remove', piece: p })} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {pieces.length === 0 && (
        <div className="list">
          <EmptyState icon={<IconUpload size={28} />} title="Nenhuma peça ainda">Envie os vídeos e imagens deste anunciante.</EmptyState>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Histórico</h2>
      <div className="list">
        {reviews.map((r, i) => (
          <div className="row" key={i}>
            <div className="row-main">
              <div>
                {r.action === 'payment' ? (r.reason === 'paid' ? 'Pagamento marcado como pago' : 'Pagamento marcado como pendente') : EVENT_LABEL[r.action] ?? r.action}
                {r.mediaId && pieceById.get(r.mediaId) ? ` — ${pieceName(pieceById.get(r.mediaId)!)}` : ''}
              </div>
              <div className="row-sub">
                {new Date(r.createdAt).toLocaleString('pt-BR')}
                {r.reason && r.action !== 'payment' ? ` · ${r.reason}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={dialog?.kind === 'reject'}
        title="Recusar peça"
        confirmLabel="Recusar"
        danger
        busy={busy || reason.trim().length < 3}
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog?.kind !== 'reject') return;
          const p = dialog.piece;
          closeDialog();
          void run(() => api(`/api/campaigns/${c.id}/pieces/${p.id}/reject`, { method: 'POST', body: { reason: reason.trim() } }), `${pieceName(p)} recusada.`);
        }}
      >
        <Field label="Motivo">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O anunciante verá este motivo." />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        title="Remover peça"
        confirmLabel="Remover"
        danger
        busy={busy}
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog?.kind !== 'remove') return;
          const p = dialog.piece;
          closeDialog();
          void run(() => api(`/api/campaigns/${c.id}/pieces/${p.id}/remove`, { method: 'POST' }), `${pieceName(p)} removida.`);
        }}
      >
        {dialog?.kind === 'remove' && `${pieceName(dialog.piece)} sai das TVs e libera a vaga no plano.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        title="Cancelar assinatura"
        confirmLabel="Cancelar assinatura"
        danger
        busy={busy}
        onCancel={closeDialog}
        onConfirm={() => {
          closeDialog();
          void run(() => api(`/api/campaigns/${c.id}/cancel`, { method: 'POST' }), 'Assinatura cancelada.');
        }}
      >
        As peças saem das TVs e a assinatura não pode ser reativada.
      </ConfirmDialog>
    </>
  );
}

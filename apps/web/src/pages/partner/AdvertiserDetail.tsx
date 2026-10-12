import {
  IconArchive, IconArchiveOff, IconCalendarEvent, IconChartBar, IconEdit, IconSpeakerphone, IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api';
import { formatDate, formatDocument, lastDay, maskPhone, maskZip } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser, AdvertiserDetail as Detail } from '../../types';
import { Badge, ConfirmDialog, EmptyState, IconButton, Notice, PageHeader, StatCard } from '../../ui';

function address(a: Advertiser): string {
  const line1 = [a.street, a.number, a.complement].filter(Boolean).join(', ');
  const line2 = [a.district, a.city && `${a.city}${a.state ? `/${a.state}` : ''}`, a.zip && `CEP ${maskZip(a.zip)}`].filter(Boolean).join(' · ');
  return [line1, line2].filter(Boolean).join(' — ');
}

export function AdvertiserDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api<Detail>(`/api/partner/advertisers/${id}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id]);

  async function toggleArchive() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const action = data.advertiser.archivedAt ? 'unarchive' : 'archive';
      const r = await api<{ advertiser: Advertiser }>(`/api/partner/advertisers/${id}/${action}`, { method: 'POST' });
      setData({ ...data, advertiser: r.advertiser });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const cancelDelete = useCallback(() => setConfirming(false), []);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/partner/advertisers/${id}`, { method: 'DELETE' });
      navigate('/parceiro/anunciantes');
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
      setBusy(false);
    }
  }

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <div className="muted">Carregando…</div>;
  const a = data.advertiser;
  const live = a.archivedAt ? 0 : data.campaigns.filter((c) => c.effectiveStatus === 'active').length;
  const rows: [string, string][] = [
    [a.personType === 'pf' ? 'CPF' : 'CNPJ', formatDocument(a.document) || '—'],
    ...(a.personType === 'pj' ? ([['Razão social', a.legalName ?? '—']] as [string, string][]) : []),
    ['Contato', a.contactName ?? '—'],
    ['E-mail', a.email ?? '—'],
    ['Telefone', a.phone ? maskPhone(a.phone) : '—'],
    ['WhatsApp', a.whatsapp ? maskPhone(a.whatsapp) : '—'],
    ['Endereço', address(a) || '—'],
    ['Origem', a.source === 'self_signup' ? 'Autocadastro na página pública' : 'Cadastro manual'],
  ];

  return (
    <>
      <PageHeader
        title={a.name}
        action={
          <div className="actions">
            <Link className="btn" to={`/parceiro/anunciantes/${id}/editar`}><IconEdit size={16} />Editar</Link>
            <IconButton
              icon={a.archivedAt ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
              label={a.archivedAt ? 'Desarquivar' : 'Arquivar'}
              disabled={busy}
              onClick={toggleArchive}
            />
            <IconButton icon={<IconTrash size={16} />} label="Excluir" className="btn btn-danger" disabled={busy} onClick={() => setConfirming(true)} />
          </div>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      {a.archivedAt && <Notice kind="info">Arquivado em {formatDate(a.archivedAt)}. As campanhas deste anunciante não aparecem nas TVs.</Notice>}
      <div className="stats">
        <StatCard icon={<IconChartBar size={20} />} label="Inserções no mês" value={data.playsThisMonth} />
        <StatCard icon={<IconSpeakerphone size={20} />} label="Campanhas no ar" value={live} />
        <StatCard icon={<IconCalendarEvent size={20} />} label="Campanhas no total" value={data.campaigns.length} />
      </div>
      <div className="card">
        <h2>Dados</h2>
        <dl className="dl">
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {a.notes && <p className="muted" style={{ marginBottom: 0 }}>{a.notes}</p>}
      </div>
      <h2>Campanhas</h2>
      <div className="list">
        {data.campaigns.map((c) => (
          <Link className="row" key={c.id} to={`/parceiro/campanhas/${c.id}`}>
            <div className="row-main">
              <div>{c.name}</div>
              <div className="row-sub">{formatDate(c.startsAt)} a {formatDate(lastDay(c.endsAt))}</div>
            </div>
            <Badge status={c.effectiveStatus} />
          </Link>
        ))}
        {data.campaigns.length === 0 && <EmptyState icon={<IconSpeakerphone size={28} />} title="Nenhuma campanha ainda" />}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Excluir"
        confirmLabel="Excluir"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={cancelDelete}
      >
        Excluir {a.name} e o acesso dele ao painel? Isso não pode ser desfeito.
      </ConfirmDialog>
    </>
  );
}

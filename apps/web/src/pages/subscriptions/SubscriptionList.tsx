import { IconCash, IconClockPause, IconHourglass, IconPlayerPlay, IconPlus, IconReceipt } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { formatDate, lastDay } from '../../format';
import { errorMessage } from '../../messages';
import type { Campaign } from '../../types';
import { Badge, EmptyState, Notice, PageHeader, SearchInput, StatCard } from '../../ui';

export type Base = '/parceiro' | '/anunciante';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SubscriptionList({ base }: { base: Base }) {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api<{ campaigns: Campaign[] }>('/api/campaigns').then((r) => setList(r.campaigns)).catch((e) => setError(errorMessage(e)));
  }, []);

  const isPartner = base === '/parceiro';
  const all = list ?? [];
  const live = all.filter((c) => c.status !== 'cancelled');
  const term = q.trim().toLowerCase();
  const shown = term
    ? all.filter((c) => `${c.name} ${c.advertiserName ?? ''} ${c.planName ?? ''}`.toLowerCase().includes(term))
    : all;

  return (
    <>
      <PageHeader
        title={isPartner ? 'Assinaturas' : 'Minhas assinaturas'}
        action={<Link className="btn btn-primary" to={`${base}/assinaturas/nova`}><IconPlus size={16} />Nova assinatura</Link>}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="stats">
        <StatCard icon={<IconPlayerPlay size={20} />} label="No ar" value={all.filter((c) => c.effectiveStatus === 'active').length} />
        <StatCard icon={<IconClockPause size={20} />} label="Pausadas" value={all.filter((c) => c.status === 'paused').length} />
        <StatCard
          icon={<IconHourglass size={20} />}
          label="Peças aguardando"
          value={live.reduce((n, c) => n + (c.pieces?.pending ?? 0), 0)}
        />
        {isPartner && (
          <StatCard icon={<IconCash size={20} />} label="A receber" value={live.filter((c) => c.paymentStatus === 'pending').length} />
        )}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Assinatura, anunciante ou plano" />
      </div>
      <div className="list">
        {shown.map((c) => (
          <Link className="row" key={c.id} to={`${base}/assinaturas/${c.id}`}>
            <div className="row-icon" aria-hidden="true"><IconReceipt size={18} /></div>
            <div className="row-main">
              <div>
                {c.name}
                {isPartner && c.paymentStatus === 'pending' && c.status !== 'cancelled' && <span className="chip">Pagamento pendente</span>}
              </div>
              <div className="row-sub">
                {[isPartner ? c.advertiserName : null, c.planName, `${formatDate(c.startsAt)} a ${lastDay(c.endsAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
                {' · '}
                {plural(c.pieces?.approved ?? 0, 'peça no ar', 'peças no ar')}
                {(c.pieces?.pending ?? 0) > 0 && ` · ${c.pieces!.pending} aguardando`}
              </div>
            </div>
            <Badge status={c.effectiveStatus} />
          </Link>
        ))}
        {list !== null && shown.length === 0 && (
          <EmptyState icon={<IconReceipt size={28} />} title={q ? 'Nenhuma assinatura encontrada' : 'Nenhuma assinatura ainda'}>
            {!q && 'Crie a primeira escolhendo o anunciante e o plano.'}
          </EmptyState>
        )}
        {list === null && !error && <div className="row muted">Carregando…</div>}
      </div>
    </>
  );
}

import { IconPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay } from '../../format';
import { errorMessage } from '../../messages';
import type { Campaign } from '../../types';
import { Badge, Notice, PageHeader } from '../../ui';

export function CampaignList({ base }: { base: '/parceiro' | '/anunciante' }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ campaigns: Campaign[] }>('/api/campaigns').then((r) => setCampaigns(r.campaigns)).catch((e) => setError(errorMessage(e)));
  }, []);

  const count = (pred: (c: Campaign) => boolean) => campaigns?.filter(pred).length ?? 0;
  const isPartner = base === '/parceiro';

  return (
    <>
      <PageHeader
        title={isPartner ? 'Campanhas' : 'Minhas campanhas'}
        action={
          <Link className="btn btn-primary" to={`${base}/campanhas/nova`}>
            <IconPlus size={16} />
            Nova campanha
          </Link>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="kpis">
        <div className="kpi"><span>Aguardando aprovação</span><strong>{count((c) => c.status === 'pending_review')}</strong></div>
        <div className="kpi"><span>Ativas</span><strong>{count((c) => c.effectiveStatus === 'active')}</strong></div>
        <div className="kpi"><span>Em preparação</span><strong>{count((c) => c.status === 'draft' || c.status === 'changes_requested')}</strong></div>
      </div>
      <div className="list">
        {campaigns?.map((c) => (
          <Link className="row" key={c.id} to={`${base}/campanhas/${c.id}`}>
            <div className="row-main">
              <div>{c.name}</div>
              <div className="row-sub">
                {isPartner && c.advertiserName ? `${c.advertiserName} · ` : ''}
                {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()}
              </div>
            </div>
            <Badge status={c.effectiveStatus} />
          </Link>
        ))}
        {campaigns?.length === 0 && <div className="row muted">Nenhuma campanha ainda.</div>}
        {campaigns === null && !error && <div className="row muted">Carregando…</div>}
      </div>
    </>
  );
}

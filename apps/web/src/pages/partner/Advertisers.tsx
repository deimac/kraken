import { IconArchive, IconBuildingStore, IconPlus, IconSpeakerphone, IconUser, IconUsers } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { formatDocument } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser } from '../../types';
import { EmptyState, Notice, PageHeader, SearchInput, StatCard } from '../../ui';

const fetchList = (archived: boolean, q = '') => {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (archived) params.set('archived', '1');
  const qs = params.toString();
  return api<{ advertisers: Advertiser[] }>(`/api/partner/advertisers${qs ? `?${qs}` : ''}`).then((r) => r.advertisers);
};

export function Advertisers() {
  const [active, setActive] = useState<Advertiser[]>([]);
  const [archived, setArchived] = useState<Advertiser[]>([]);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Advertiser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchList(false), fetchList(true)])
      .then(([a, b]) => {
        setActive(a);
        setArchived(b);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      fetchList(tab === 'archived', q).then(setResults).catch((e) => setError(errorMessage(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, tab]);

  const shown = results ?? (tab === 'active' ? active : archived);

  return (
    <>
      <PageHeader
        title="Anunciantes"
        action={<Link className="btn btn-primary" to="/parceiro/anunciantes/novo"><IconPlus size={16} />Novo anunciante</Link>}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="stats">
        <StatCard icon={<IconUsers size={20} />} label="Ativos" value={active.length} />
        <StatCard icon={<IconSpeakerphone size={20} />} label="Com campanha no ar" value={active.filter((a) => (a.activeCampaigns ?? 0) > 0).length} />
        <StatCard icon={<IconArchive size={20} />} label="Arquivados" value={archived.length} />
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Nome, CPF/CNPJ ou e-mail" />
        <div className="tabs" role="group" aria-label="Situação">
          <button type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')}>Ativos</button>
          <button type="button" aria-pressed={tab === 'archived'} onClick={() => setTab('archived')}>Arquivados</button>
        </div>
      </div>
      <div className="list">
        {shown.map((a) => (
          <Link className="row" key={a.id} to={`/parceiro/anunciantes/${a.id}`}>
            <div className="row-icon" aria-hidden="true">{a.personType === 'pf' ? <IconUser size={18} /> : <IconBuildingStore size={18} />}</div>
            <div className="row-main">
              <div>
                {a.name}
                {a.source === 'self_signup' && <span className="chip">autocadastro</span>}
              </div>
              <div className="row-sub">
                {[formatDocument(a.document), a.city && `${a.city}${a.state ? `/${a.state}` : ''}`, a.contactName, a.email, a.phone]
                  .filter(Boolean)
                  .join(' · ') || 'Sem dados de contato'}
              </div>
            </div>
            {(a.activeCampaigns ?? 0) > 0 && <span className="badge badge-active">{a.activeCampaigns} no ar</span>}
          </Link>
        ))}
        {shown.length === 0 && (
          <EmptyState icon={<IconBuildingStore size={28} />} title={q ? 'Nenhum anunciante encontrado' : tab === 'active' ? 'Nenhum anunciante ainda' : 'Nenhum anunciante arquivado'}>
            {!q && tab === 'active' && 'Cadastre o primeiro ou divulgue sua página pública.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

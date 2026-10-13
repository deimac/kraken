import {
  IconAlertTriangle, IconBuildingStore, IconCash, IconChartBar, IconClockPause, IconDeviceTv, IconDeviceTvOff, IconHourglass,
  IconPhoto, IconPlayerPlay, IconUsersGroup,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { lastDay } from '../format';
import { errorMessage } from '../messages';
import { BarChart, Notice, PageHeader, StatCard } from '../ui';

type Days = { day: string; count: number }[];
type Stats = Record<string, number>;
type Data =
  | {
      role: 'partner'; stats: Stats; days: Days;
      expiring: { id: string; name: string; advertiserName: string | null; endsAt: string }[];
      tv: { configured: boolean; lastSeenAt: string | null; online: boolean };
    }
  | { role: 'advertiser'; stats: Stats; days: Days }
  | { role: 'admin'; stats: Stats; days: Days };

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const v = (s: Stats, k: string) => (s[k] ?? 0).toLocaleString('pt-BR');

function PlaysChart({ days }: { days: Days }) {
  return (
    <div className="card">
      <h2>Inserções por dia</h2>
      <p className="muted" style={{ marginTop: -6 }}>Últimos 14 dias, horário de Brasília.</p>
      <BarChart label="Inserções por dia" data={days.map((d) => ({ label: d.day, value: d.count }))} format={ddmm} />
    </div>
  );
}

function TvStatus({ tv }: { tv: Extract<Data, { role: 'partner' }>['tv'] }) {
  if (!tv.configured) {
    return (
      <div className="tv-status tv-off">
        <IconDeviceTvOff size={20} aria-hidden="true" />
        <div>
          <strong>TV não configurada</strong>
          <div className="muted"><Link to="/parceiro/tv">Configurar a TV</Link> para começar a exibir os anúncios.</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`tv-status ${tv.online ? 'tv-on' : 'tv-off'}`}>
      {tv.online ? <IconDeviceTv size={20} aria-hidden="true" /> : <IconAlertTriangle size={20} aria-hidden="true" />}
      <div>
        <strong>{tv.online ? 'TV online' : 'TV offline'}</strong>
        <div className="muted">
          {tv.lastSeenAt ? `Último contato: ${new Date(tv.lastSeenAt).toLocaleString('pt-BR')}` : 'A TV ainda não se conectou.'}
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Data>('/api/dashboard').then(setData).catch((e) => setError(errorMessage(e)));
  }, []);

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <div className="muted">Carregando…</div>;
  const s = data.stats;

  return (
    <>
      <PageHeader title="Início" />
      {data.role === 'partner' && (
        <>
          <TvStatus tv={data.tv} />
          <div className="stats">
            <StatCard icon={<IconPlayerPlay size={20} />} label="No ar" value={v(s, 'live')} hint={`${v(s, 'paused')} pausadas`} />
            <StatCard icon={<IconChartBar size={20} />} label="Inserções hoje" value={v(s, 'playsToday')} hint={`${v(s, 'plays7d')} em 7 dias`} />
            <StatCard icon={<IconBuildingStore size={20} />} label="Anunciantes" value={v(s, 'advertisers')} />
            <StatCard icon={<IconHourglass size={20} />} label="Peças aguardando" value={v(s, 'pendingPieces')} />
            <StatCard icon={<IconCash size={20} />} label="Pagamentos pendentes" value={v(s, 'paymentPending')} hint="assinaturas no ar ou agendadas" />
          </div>
          {(s.pendingPieces ?? 0) > 0 && (
            <Notice kind="info">
              {s.pendingPieces === 1 ? 'Há 1 peça' : `Há ${s.pendingPieces} peças`} enviadas por anunciantes.{' '}
              <Link to="/parceiro/assinaturas">Ver e aprovar</Link>
            </Notice>
          )}
          <PlaysChart days={data.days} />
          <div className="card">
            <h2>Vencendo nos próximos 30 dias</h2>
            {data.expiring.length === 0 ? (
              <p className="muted">Nenhuma assinatura vence nos próximos 30 dias.</p>
            ) : (
              <div className="list">
                {data.expiring.map((e) => (
                  <Link className="row" key={e.id} to={`/parceiro/assinaturas/${e.id}`}>
                    <div className="row-main">
                      <div>{e.name}</div>
                      <div className="row-sub">Último dia: {lastDay(e.endsAt)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {data.role === 'advertiser' && (
        <>
          <div className="stats">
            <StatCard icon={<IconChartBar size={20} />} label="Inserções no mês" value={v(s, 'playsMonth')} hint={`${v(s, 'playsToday')} hoje`} />
            <StatCard icon={<IconPlayerPlay size={20} />} label="Assinaturas no ar" value={v(s, 'live')} />
            <StatCard icon={<IconPhoto size={20} />} label="Peças no ar" value={v(s, 'livePieces')} />
            <StatCard icon={<IconClockPause size={20} />} label="Aguardando aprovação" value={v(s, 'pendingPieces')} />
          </div>
          <PlaysChart days={data.days} />
        </>
      )}
      {data.role === 'admin' && (
        <>
          <div className="stats">
            <StatCard icon={<IconUsersGroup size={20} />} label="Parceiros ativos" value={v(s, 'partners')} />
            <StatCard icon={<IconDeviceTv size={20} />} label="TVs online" value={`${v(s, 'tvsOnline')}/${v(s, 'tvsTotal')}`} />
            <StatCard icon={<IconPlayerPlay size={20} />} label="No ar" value={v(s, 'live')} />
            <StatCard icon={<IconChartBar size={20} />} label="Inserções hoje" value={v(s, 'playsToday')} hint={`${v(s, 'plays7d')} em 7 dias`} />
          </div>
          <PlaysChart days={data.days} />
        </>
      )}
    </>
  );
}


import { IconDownload } from '@tabler/icons-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { ReportCampaign } from '../../types';
import { BarChart, Field, Notice, PageHeader } from '../../ui';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const br = (day: string) => day.split('-').reverse().join('/');
const fmt = (n: number) => n.toLocaleString('pt-BR');

function defaultRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  return { from: iso(start), to: iso(today) };
}

export function Reports() {
  const [initial] = useState(defaultRange);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [query, setQuery] = useState(initial);
  const [rows, setRows] = useState<ReportCampaign[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ campaigns: ReportCampaign[] }>(`/api/reports/plays?from=${query.from}&to=${query.to}`)
      .then((r) => setRows(r.campaigns))
      .catch((e) => setError(errorMessage(e)));
  }, [query]);
  useEffect(load, [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (to < from) {
      setError('A data final precisa ser igual ou posterior à inicial.');
      return;
    }
    setQuery({ from, to });
  }

  const total = rows?.reduce((sum, r) => sum + r.total, 0) ?? 0;
  const csv = `/api/reports/plays.csv?from=${query.from}&to=${query.to}`;
  const perDay = dailyTotals(rows ?? [], query.from, query.to);

  return (
    <>
      <PageHeader
        title="Relatórios"
        action={
          <a className="btn" href={csv}>
            <IconDownload size={16} />
            Baixar CSV
          </a>
        }
      />
      <p className="muted" style={{ marginTop: -12 }}>
        Inserções = anúncios exibidos até o fim nas TVs. Dias no horário de Brasília.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <form className="form-row card" style={{ maxWidth: 520, alignItems: 'end' }} onSubmit={submit}>
        <Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
        <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} required /></Field>
        <div><button className="btn btn-primary" type="submit">Atualizar</button></div>
      </form>
      {rows && rows.length > 0 && <p><strong>Total no período: {fmt(total)} inserções</strong></p>}
      {rows && rows.length > 0 && perDay && (
        <div className="card">
          <BarChart label="Inserções por dia no período" data={perDay} format={(d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} />
        </div>
      )}
      <div className="list">
        {rows?.map((r) => (
          <div key={r.campaignId}>
            <div className="row">
              <div className="row-main">
                <div>{r.name}</div>
                <div className="row-sub">{r.kind === 'institutional' ? 'Kraken Ads · institucional' : r.advertiserName}</div>
              </div>
              <strong>{fmt(r.total)}</strong>
              <button
                className="btn"
                type="button"
                aria-label={`Ver dias de ${r.name}`}
                aria-expanded={open === r.campaignId}
                onClick={() => setOpen(open === r.campaignId ? null : r.campaignId)}
              >
                Dias
              </button>
            </div>
            {open === r.campaignId && (
              <ul className="timeline" style={{ padding: '0 14px 12px' }}>
                {r.pieces.length > 1 &&
                  r.pieces.map((p) => (
                    <li key={p.mediaId} className="row" style={{ padding: '4px 0' }}>
                      <span className="row-main">{p.mediaType === 'video' ? 'Vídeo' : 'Imagem'}: {p.label}</span>
                      <span>{fmt(p.total)}</span>
                    </li>
                  ))}
                {r.days.map((d) => (
                  <li key={d.day} className="row" style={{ padding: '4px 0' }}>
                    <span className="row-main">{br(d.day)}</span>
                    <span>{fmt(d.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {rows?.length === 0 && <div className="row muted">Nenhuma inserção no período.</div>}
        {rows === null && !error && <div className="row muted">Carregando…</div>}
      </div>
    </>
  );
}

const MAX_CHART_DAYS = 62;

/** Sum of all subscriptions per day, every day of the period (zeros included); null when too long to chart. */
function dailyTotals(rows: ReportCampaign[], from: string, to: string): { label: string; value: number }[] | null {
  const byDay = new Map<string, number>();
  for (const r of rows) for (const d of r.days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.count);
  const known = [...byDay.keys()].sort();
  const start = known[0] && known[0] < from ? known[0] : from;
  const end = known.at(-1) && known.at(-1)! > to ? known.at(-1)! : to;
  const out: { label: string; value: number }[] = [];
  for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ label: day, value: byDay.get(day) ?? 0 });
    if (out.length > MAX_CHART_DAYS) return null;
  }
  return out;
}

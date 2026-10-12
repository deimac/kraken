import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay, toApiRange } from '../../format';
import { errorMessage } from '../../messages';
import type { Campaign, FrequencyLevel } from '../../types';
import { Badge, Field, Notice, PageHeader } from '../../ui';

export function Institutional() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<FrequencyLevel>('low');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ campaigns: Campaign[] }>('/api/admin/campaigns')
      .then((r) => setCampaigns(r.campaigns))
      .catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (end < start) return setMsg({ kind: 'error', text: 'A data de término precisa ser igual ou posterior à de início.' });
    setBusy(true);
    try {
      await api('/api/admin/campaigns', { method: 'POST', body: { name, frequencyLevel: frequency, ...toApiRange(start, end) } });
      setName('');
      setStart('');
      setEnd('');
      setMsg({ kind: 'ok', text: 'Campanha criada. Envie a mídia para ela entrar na rotação.' });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function upload(c: Campaign, file: File) {
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/api/admin/campaigns/${c.id}/media`, { method: 'POST', form });
      setMsg({ kind: 'ok', text: `Mídia enviada para ${c.name}.` });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  async function cancel(c: Campaign) {
    if (!window.confirm(`Cancelar ${c.name}? Ela sai da rotação.`)) return;
    try {
      await api(`/api/admin/campaigns/${c.id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader title="Institucionais" />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {campaigns.map((c) => (
          <div className="row" key={c.id}>
            <div className="row-main">
              <div>{c.name}</div>
              <div className="row-sub">
                {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()} ·{' '}
                {c.currentMediaId ? 'com mídia' : 'sem mídia'}
              </div>
            </div>
            <Badge status={c.effectiveStatus} />
            {c.status === 'approved' && (
              <>
                <label className="btn">
                  Enviar mídia
                  <input
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4"
                    onChange={(e) => e.target.files?.[0] && upload(c, e.target.files[0])}
                  />
                </label>
                <button className="btn btn-danger" type="button" onClick={() => cancel(c)}>Cancelar</button>
              </>
            )}
          </div>
        ))}
        {campaigns.length === 0 && <div className="row muted">Nenhuma campanha institucional.</div>}
      </div>
      <div className="card">
        <h2>Nova campanha institucional</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Frequência">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as FrequencyLevel)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </Field>
          <div className="form-row">
            <Field label="Início"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
            <Field label="Fim"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar campanha</button></div>
        </form>
      </div>
    </>
  );
}

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, toApiRange } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser, Campaign, Plan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function CampaignForm({ base }: { base: '/parceiro' | '/anunciante' }) {
  const isPartner = base === '/parceiro';
  const navigate = useNavigate();
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ advertiserId: '', planId: '', name: '', start: '', end: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const plansUrl = isPartner ? '/api/partner/plans' : '/api/advertiser/plans';
    api<{ plans: Plan[] }>(plansUrl)
      .then((r) => setPlans(r.plans.filter((p) => p.active !== false)))
      .catch((e) => setError(errorMessage(e)));
    if (isPartner) {
      api<{ advertisers: Advertiser[] }>('/api/partner/advertisers')
        .then((r) => setAdvertisers(r.advertisers))
        .catch((e) => setError(errorMessage(e)));
    }
  }, [isPartner]);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.end < form.start) {
      setError('A data de término precisa ser igual ou posterior à de início.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ campaign: Campaign }>('/api/campaigns', {
        method: 'POST',
        body: {
          ...(isPartner ? { advertiserId: form.advertiserId } : {}),
          planId: form.planId,
          name: form.name,
          ...toApiRange(form.start, form.end),
        },
      });
      navigate(`${base}/campanhas/${r.campaign.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Nova campanha" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card">
        <form className="form" onSubmit={submit}>
          {isPartner && (
            <Field label="Anunciante">
              <select value={form.advertiserId} onChange={set('advertiserId')} required>
                <option value="">Escolha…</option>
                {advertisers.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Plano">
            <select value={form.planId} onChange={set('planId')} required>
              <option value="">Escolha…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nome da campanha"><input value={form.name} onChange={set('name')} required /></Field>
          <div className="form-row">
            <Field label="Primeiro dia"><input type="date" value={form.start} onChange={set('start')} required /></Field>
            <Field label="Último dia"><input type="date" value={form.end} onChange={set('end')} required /></Field>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar campanha</button></div>
        </form>
      </div>
    </>
  );
}

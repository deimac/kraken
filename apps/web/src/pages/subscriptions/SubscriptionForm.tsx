import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatPlanPrice, isoDay, periodEnd, planLimits, toApiRange } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser, Campaign, Plan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';
import type { Base } from './SubscriptionList';

export function SubscriptionForm({ base }: { base: Base }) {
  const isPartner = base === '/parceiro';
  const navigate = useNavigate();
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [advertiserId, setAdvertiserId] = useState('');
  const [planId, setPlanId] = useState('');
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => isoDay(new Date()));
  const [end, setEnd] = useState('');
  const [endTouched, setEndTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: Plan[] }>(isPartner ? '/api/partner/plans' : '/api/advertiser/plans')
      .then((r) => setPlans(r.plans.filter((p) => p.active !== false)))
      .catch((e) => setError(errorMessage(e)));
    if (isPartner) {
      api<{ advertisers: Advertiser[] }>('/api/partner/advertisers')
        .then((r) => setAdvertisers(r.advertisers))
        .catch((e) => setError(errorMessage(e)));
    }
  }, [isPartner]);

  const plan = plans.find((p) => p.id === planId);
  // The last day follows the plan period until the person picks one.
  useEffect(() => {
    if (!endTouched && plan && start) setEnd(periodEnd(start, plan.periodMonths));
  }, [plan, start, endTouched]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (end < start) return setError('A data de término precisa ser igual ou posterior à de início.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ campaign: Campaign }>('/api/campaigns', {
        method: 'POST',
        body: {
          ...(isPartner ? { advertiserId } : {}),
          planId,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...toApiRange(start, end),
        },
      });
      navigate(`${base}/assinaturas/${r.campaign.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Nova assinatura" />
      {error && <Notice kind="error">{error}</Notice>}
      <form className="card form form-wide" onSubmit={submit}>
        {!isPartner && (
          <Notice kind="info">Depois de criada, a assinatura entra no ar quando o estabelecimento confirmar.</Notice>
        )}
        <div className="form-row">
          {isPartner && (
            <Field label="Anunciante">
              <select value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} required>
                <option value="">Escolha…</option>
                {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Plano">
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
              <option value="">Escolha…</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        {plan && (
          <div className="plan-card plan-summary">
            <div className="plan-head">
              <strong>{plan.name}</strong>
              <span className="chip">Frequência {FREQUENCY_LABEL[plan.frequencyLevel].toLowerCase()}</span>
            </div>
            <div className="plan-price">{formatPlanPrice(plan.priceCents, plan.periodMonths)}</div>
            <div className="plan-limits">{planLimits(plan)}</div>
          </div>
        )}
        <div className="form-row">
          <Field label="Primeiro dia"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
          <Field label="Último dia">
            <input
              type="date"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setEndTouched(true);
              }}
              required
            />
          </Field>
        </div>
        <Field label="Nome (opcional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Black Friday — se vazio, usa anunciante e plano" />
        </Field>
        <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar assinatura</button></div>
      </form>
    </>
  );
}

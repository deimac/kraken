import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { formatMoney, parseMoney } from '../../format';
import { errorMessage } from '../../messages';
import type { MidoraPlan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function MidoraPlans() {
  const [plans, setPlans] = useState<MidoraPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: MidoraPlan[] }>('/api/admin/midora-plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function toggle(p: MidoraPlan) {
    try {
      const r = await api<{ plan: MidoraPlan }>(`/api/admin/midora-plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      setPlans((l) => l.map((x) => (x.id === p.id ? r.plan : x)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const priceCents = parseMoney(price);
    if (priceCents === undefined) return setError('Valor inválido. Use o formato 99,90.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: MidoraPlan }>('/api/admin/midora-plans', {
        method: 'POST',
        body: { name, ...(description.trim() ? { description } : {}), ...(priceCents !== null ? { priceCents } : {}) },
      });
      setPlans((l) => [...l, r.plan].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setDescription('');
      setPrice('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Planos Midora" />
      <p className="muted" style={{ marginTop: -12 }}>
        Planos que o Midora oferece aos parceiros. Ainda sem cobrança: servem de registro do que cada parceiro contratou.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {plans.map((p) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div>{p.name}</div>
              <div className="row-sub">{formatMoney(p.priceCents)}{p.description ? ` · ${p.description}` : ''}</div>
            </div>
            <span className={`badge ${p.active ? 'badge-active' : 'badge-off'}`}>{p.active ? 'Ativo' : 'Inativo'}</span>
            <button className="btn" type="button" aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onClick={() => toggle(p)}>
              {p.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {plans.length === 0 && <div className="row muted">Nenhum Plano Midora cadastrado.</div>}
      </div>
      <div className="card">
        <h2>Novo Plano Midora</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do plano"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Valor mensal de referência (R$)">
            <input inputMode="decimal" placeholder="99,90" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Descrição"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar plano</button></div>
        </form>
      </div>
    </>
  );
}

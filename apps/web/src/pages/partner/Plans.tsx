import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { FREQUENCY_LABEL } from '../../format';
import { errorMessage } from '../../messages';
import type { FrequencyLevel, Plan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<FrequencyLevel>('low');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: Plan[] }>('/api/partner/plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function toggle(p: Plan) {
    try {
      const r = await api<{ plan: Plan }>(`/api/partner/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      setPlans((l) => l.map((x) => (x.id === p.id ? r.plan : x)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: Plan }>('/api/partner/plans', {
        method: 'POST',
        body: { name, frequencyLevel: frequency, ...(description.trim() ? { description } : {}) },
      });
      setPlans((l) => [...l, r.plan].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setDescription('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Planos de anúncio" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {plans.map((p) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div>{p.name}</div>
              <div className="row-sub">
                Frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}
                {p.description ? ` · ${p.description}` : ''}
              </div>
            </div>
            <span className={`badge ${p.active ? 'badge-active' : 'badge-off'}`}>{p.active ? 'Ativo' : 'Inativo'}</span>
            <button className="btn" type="button" aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onClick={() => toggle(p)}>
              {p.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {plans.length === 0 && <div className="row muted">Crie o primeiro plano para os anunciantes escolherem.</div>}
      </div>
      <div className="card">
        <h2>Novo plano de anúncio</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do plano"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Frequência">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as FrequencyLevel)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </Field>
          <Field label="Descrição (aparece na página pública)">
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar plano</button></div>
        </form>
      </div>
    </>
  );
}

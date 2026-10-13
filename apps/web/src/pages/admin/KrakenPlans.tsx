import { IconEdit } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { centsToInput, formatMoney, parseMoney } from '../../format';
import { errorMessage } from '../../messages';
import type { KrakenPlan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function KrakenPlans() {
  const [plans, setPlans] = useState<KrakenPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<KrakenPlan | null>(null);

  useEffect(() => {
    api<{ plans: KrakenPlan[] }>('/api/admin/kraken-plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function toggle(p: KrakenPlan) {
    try {
      const r = await api<{ plan: KrakenPlan }>(`/api/admin/kraken-plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      setPlans((l) => l.map((x) => (x.id === p.id ? r.plan : x)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function edit(p: KrakenPlan) {
    setEditing(p);
    setName(p.name);
    setDescription(p.description);
    setPrice(centsToInput(p.priceCents));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const priceCents = parseMoney(price);
    if (priceCents === undefined) return setError('Valor inválido. Use o formato 99,90.');
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const r = await api<{ plan: KrakenPlan }>(`/api/admin/kraken-plans/${editing.id}`, {
          method: 'PATCH',
          body: { name, description, priceCents },
        });
        setPlans((l) => l.map((x) => (x.id === r.plan.id ? r.plan : x)).sort((a, b) => a.name.localeCompare(b.name)));
        setEditing(null);
      } else {
        const r = await api<{ plan: KrakenPlan }>('/api/admin/kraken-plans', {
          method: 'POST',
          body: { name, ...(description.trim() ? { description } : {}), ...(priceCents !== null ? { priceCents } : {}) },
        });
        setPlans((l) => [...l, r.plan].sort((a, b) => a.name.localeCompare(b.name)));
      }
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
      <PageHeader title="Planos Kraken" />
      <p className="muted" style={{ marginTop: -12 }}>
        Planos que o Kraken Ads oferece aos parceiros. Ainda sem cobrança: servem de registro do que cada parceiro contratou.
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
            <button className="btn" type="button" aria-label={`Editar ${p.name}`} onClick={() => edit(p)}>
              <IconEdit size={16} />Editar
            </button>
            <button className="btn" type="button" aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onClick={() => toggle(p)}>
              {p.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {plans.length === 0 && <div className="row muted">Nenhum Plano Kraken cadastrado.</div>}
      </div>
      <div className="card">
        <h2>{editing ? 'Editar Plano Kraken' : 'Novo Plano Kraken'}</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do plano"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Valor mensal de referência (R$)">
            <input inputMode="decimal" placeholder="99,90" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Descrição"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>{editing ? 'Salvar plano' : 'Criar plano'}</button>
            {editing && (
              <button className="btn" type="button" onClick={() => { setEditing(null); setName(''); setDescription(''); setPrice(''); }}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}

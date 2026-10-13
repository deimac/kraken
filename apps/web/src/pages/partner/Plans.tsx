import { IconArchive, IconArchiveOff, IconEdit, IconPhoto, IconPlus, IconTags, IconVideo } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { FREQUENCY_LABEL, PERIOD_LABEL, centsToInput, formatPlanPrice, parseMoney, planLimits } from '../../format';
import { errorMessage } from '../../messages';
import type { FrequencyLevel, Plan } from '../../types';
import { EmptyState, Field, IconButton, Notice, PageHeader, StatCard } from '../../ui';

interface FormState {
  name: string; description: string; frequencyLevel: FrequencyLevel; maxVideos: string; maxImages: string;
  maxVideoSeconds: string; price: string; periodMonths: string;
}
const EMPTY: FormState = { name: '', description: '', frequencyLevel: 'low', maxVideos: '1', maxImages: '1', maxVideoSeconds: '30', price: '', periodMonths: '1' };

const fromPlan = (p: Plan): FormState => ({
  name: p.name, description: p.description, frequencyLevel: p.frequencyLevel, maxVideos: String(p.maxVideos), maxImages: String(p.maxImages),
  maxVideoSeconds: String(p.maxVideoSeconds), price: centsToInput(p.priceCents), periodMonths: String(p.periodMonths),
});

const byName = (a: Plan, b: Plan) => a.name.localeCompare(b.name);

export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api<{ plans: Plan[] }>('/api/partner/plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [editing]);

  function open(target: Plan | 'new') {
    setEditing(target);
    setForm(target === 'new' ? EMPTY : fromPlan(target));
    if (target === 'new') setTab('active');
    setFormError(null);
  }

  async function toggleArchive(p: Plan) {
    try {
      const r = await api<{ plan: Plan }>(`/api/partner/plans/${p.id}/${p.active === false ? 'unarchive' : 'archive'}`, { method: 'POST' });
      setPlans((l) => l.map((x) => (x.id === p.id ? r.plan : x)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const priceCents = parseMoney(form.price);
    if (priceCents === undefined || (priceCents ?? 0) > 100_000_000) return setFormError('Valor inválido. Use o formato 300,00.');
    if (Number(form.maxVideos) + Number(form.maxImages) <= 0) return setFormError(errorMessage(new ApiError(400, 'invalid_limits')));
    setBusy(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      name: form.name, frequencyLevel: form.frequencyLevel, maxVideos: Number(form.maxVideos), maxImages: Number(form.maxImages),
      maxVideoSeconds: Number(form.maxVideoSeconds), priceCents: priceCents ?? 0, periodMonths: Number(form.periodMonths),
    };
    if (editing !== 'new' || form.description.trim()) body.description = form.description;
    try {
      if (editing === 'new') {
        const r = await api<{ plan: Plan }>('/api/partner/plans', { method: 'POST', body });
        setPlans((l) => [...l, r.plan].sort(byName));
      } else if (editing) {
        const r = await api<{ plan: Plan }>(`/api/partner/plans/${editing.id}`, { method: 'PATCH', body });
        setPlans((l) => l.map((x) => (x.id === r.plan.id ? r.plan : x)).sort(byName));
      }
      setEditing(null);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const active = plans.filter((p) => p.active !== false);
  const archived = plans.filter((p) => p.active === false);
  const shown = tab === 'active' ? active : archived;

  return (
    <>
      <PageHeader
        title="Planos de anúncio"
        action={<IconButton className="btn btn-primary" icon={<IconPlus size={16} />} label="Novo plano" onClick={() => open('new')} />}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="stats">
        <StatCard icon={<IconTags size={20} />} label="Planos ativos" value={active.length} />
        <StatCard icon={<IconArchive size={20} />} label="Arquivados" value={archived.length} />
      </div>
      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Situação">
          <button type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')}>Ativos</button>
          <button type="button" aria-pressed={tab === 'archived'} onClick={() => setTab('archived')}>Arquivados</button>
        </div>
      </div>
      <div className="plan-grid">
        {shown.map((p) => (
          <div className={`plan-card${p.active === false ? ' plan-off' : ''}`} key={p.id}>
            <div className="plan-head">
              <strong>{p.name}</strong>
              <span className="chip">Frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}</span>
            </div>
            <div className="plan-price">{formatPlanPrice(p.priceCents, p.periodMonths)}</div>
            <div className="plan-limits">
              {p.maxVideos > 0 && <IconVideo size={16} aria-hidden="true" />}
              {p.maxImages > 0 && <IconPhoto size={16} aria-hidden="true" />}
              <span>{planLimits(p)}</span>
            </div>
            {p.description && <p className="muted plan-desc">{p.description}</p>}
            <div className="actions">
              <IconButton icon={<IconEdit size={16} />} label="Editar" aria-label={`Editar ${p.name}`} onClick={() => open(p)} />
              <IconButton
                icon={p.active === false ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                label={p.active === false ? 'Reativar' : 'Arquivar'}
                aria-label={`${p.active === false ? 'Reativar' : 'Arquivar'} ${p.name}`}
                onClick={() => toggleArchive(p)}
              />
            </div>
          </div>
        ))}
      </div>
      {shown.length === 0 && (
        <div className="list">
          <EmptyState icon={<IconTags size={28} />} title={tab === 'active' ? 'Nenhum plano ativo' : 'Nenhum plano arquivado'}>
            {tab === 'active' && 'Crie o primeiro plano para os anunciantes escolherem.'}
          </EmptyState>
        </div>
      )}
      {editing && (
        <form ref={formRef} className="card form form-wide" onSubmit={submit} style={{ marginTop: 16 }}>
          <h2>{editing === 'new' ? 'Novo plano' : 'Editar plano'}</h2>
          {formError && <Notice kind="error">{formError}</Notice>}
          <div className="form-row">
            <Field label="Nome do plano"><input value={form.name} onChange={set('name')} required /></Field>
            <Field label="Frequência">
              <select value={form.frequencyLevel} onChange={set('frequencyLevel')}>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            </Field>
          </div>
          <div className="form-row-3">
            <Field label="Vídeos"><input type="number" min={0} max={50} value={form.maxVideos} onChange={set('maxVideos')} required /></Field>
            <Field label="Imagens"><input type="number" min={0} max={50} value={form.maxImages} onChange={set('maxImages')} required /></Field>
            <Field label="Duração máx. do vídeo (s)">
              <input type="number" min={5} max={300} value={form.maxVideoSeconds} onChange={set('maxVideoSeconds')} required />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Valor (R$)"><input inputMode="decimal" placeholder="300,00" value={form.price} onChange={set('price')} /></Field>
            <Field label="Período">
              <select value={form.periodMonths} onChange={set('periodMonths')}>
                {Object.entries(PERIOD_LABEL).map(([m, label]) => <option key={m} value={m}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Descrição (aparece na página pública)">
            <textarea rows={3} value={form.description} onChange={set('description')} />
          </Field>
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>{editing === 'new' ? 'Criar plano' : 'Salvar plano'}</button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </form>
      )}
    </>
  );
}

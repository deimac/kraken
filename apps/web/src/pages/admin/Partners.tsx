import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { MidoraPlan, Partner } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [plans, setPlans] = useState<MidoraPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [institutional, setInstitutional] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partners: Partner[] }>('/api/admin/partners').then((r) => setPartners(r.partners)).catch((e) => setError(errorMessage(e)));
    api<{ plans: MidoraPlan[] }>('/api/admin/midora-plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ partner: Partner }>('/api/admin/partners', {
        method: 'POST',
        body: { name, slug, showInstitutional: institutional },
      });
      setPartners((list) => [...list, r.partner].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setSlug('');
      setSlugTouched(false);
      setInstitutional(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Parceiros" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {partners.map((p) => (
          <div key={p.id}>
            <div className="row">
              <div className="row-main">
                <div>{p.name}</div>
                <div className="row-sub">
                  /p/{p.slug} · {planName(p.midoraPlanId) ? `Plano Midora: ${planName(p.midoraPlanId)}` : 'sem Plano Midora'} · institucionais{' '}
                  {p.showInstitutional ? 'sim' : 'não'}
                </div>
              </div>
              <span className={`badge ${p.status === 'active' ? 'badge-active' : 'badge-off'}`}>{p.status === 'active' ? 'Ativo' : 'Inativo'}</span>
              <button className="btn" type="button" aria-label={`Editar ${p.name}`} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                Editar
              </button>
            </div>
            {editing === p.id && (
              <PartnerEditor partner={p} plans={plans} onSaved={(np) => setPartners((list) => list.map((x) => (x.id === np.id ? np : x)))} />
            )}
          </div>
        ))}
        {partners.length === 0 && <div className="row muted">Nenhum parceiro cadastrado.</div>}
      </div>
      <div className="card">
        <h2>Novo parceiro</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do parceiro">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
            />
          </Field>
          <Field label="Endereço (slug)">
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={institutional} onChange={(e) => setInstitutional(e.target.checked)} />
            Exibir anúncios institucionais
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Criar parceiro</button>
          </div>
        </form>
      </div>
    </>
  );
}

function PartnerEditor({ partner, plans, onSaved }: { partner: Partner; plans: MidoraPlan[]; onSaved(p: Partner): void }) {
  const [form, setForm] = useState(partner);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (k: 'weightLow' | 'weightMedium' | 'weightHigh' | 'defaultImageSeconds') => ({
    value: String(form[k]),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) }),
    type: 'number',
    min: 1,
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { name, status, showInstitutional, weightLow, weightMedium, weightHigh, defaultImageSeconds, midoraPlanId } = form;
      const r = await api<{ partner: Partner }>(`/api/admin/partners/${partner.id}`, {
        method: 'PATCH',
        body: { name, status, showInstitutional, weightLow, weightMedium, weightHigh, defaultImageSeconds, midoraPlanId: midoraPlanId ?? null },
      });
      onSaved(r.partner);
      setMsg({ kind: 'ok', text: 'Alterações salvas.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/admin/partners/${partner.id}/users`, { method: 'POST', body: { email, password } });
      setMsg({ kind: 'ok', text: `Usuário ${email.trim().toLowerCase()} criado.` });
      setEmail('');
      setPassword('');
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label={`Editar ${partner.name}`} style={{ margin: 12 }}>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="form" onSubmit={save}>
        <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Situação">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Partner['status'] })}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo (desconecta usuários e TVs)</option>
          </select>
        </Field>
        <Field label="Plano Midora">
          <select value={form.midoraPlanId ?? ''} onChange={(e) => setForm({ ...form, midoraPlanId: e.target.value || null })}>
            <option value="">Sem plano</option>
            {plans
              .filter((p) => p.active || p.id === form.midoraPlanId)
              .map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.showInstitutional} onChange={(e) => setForm({ ...form, showInstitutional: e.target.checked })} />
          Exibir anúncios institucionais
        </label>
        <div className="form-row">
          <Field label="Peso baixa"><input {...num('weightLow')} /></Field>
          <Field label="Peso média"><input {...num('weightMedium')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Peso alta"><input {...num('weightHigh')} /></Field>
          <Field label="Segundos por imagem"><input {...num('defaultImageSeconds')} /></Field>
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button></div>
      </form>
      <h2 style={{ marginTop: 20 }}>Usuário do parceiro</h2>
      <form className="form" onSubmit={addUser}>
        <div className="form-row">
          <Field label="E-mail do usuário"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Senha inicial"><input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        </div>
        <div><button className="btn" type="submit" disabled={busy}>Adicionar usuário</button></div>
      </form>
    </section>
  );
}

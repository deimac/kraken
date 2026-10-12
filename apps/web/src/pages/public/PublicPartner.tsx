import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { FREQUENCY_LABEL } from '../../format';
import { errorMessage } from '../../messages';
import { ThemeToggle } from '../../ThemeToggle';
import type { Plan, User } from '../../types';
import { Field, Notice } from '../../ui';

interface PublicData {
  partner: { name: string; slug: string };
  plans: Plan[];
}

// Simple page for now (spec D9); the partner landing page replaces it later at the same address.
export function PublicPartner() {
  const { slug = '' } = useParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicData | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ companyName: '', contactName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicData>(`/api/public/partners/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(errorMessage(e))));
  }, [slug]);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function signup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      const r = await api<{ user: User }>(`/api/public/partners/${encodeURIComponent(slug)}/advertisers`, { method: 'POST', body });
      setUser(r.user);
      navigate('/anunciante/campanhas');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <div className="center-page">
        <p>Página não encontrada.</p>
      </div>
    );
  }
  if (!data) return <div className="center-page muted">{error ?? 'Carregando…'}</div>;

  return (
    <div className="main" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <h1>Anuncie na {data.partner.name}</h1>
        <ThemeToggle />
      </div>
      <p className="muted">
        Seu anúncio nas TVs do estabelecimento. Escolha um plano, crie sua conta e envie sua campanha para aprovação.
      </p>
      <div className="kpis">
        {data.plans.map((p) => (
          <div className="kpi" key={p.id}>
            <strong style={{ fontSize: 16 }}>{p.name}</strong>
            <span>Frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}</span>
            {p.description && <span>{p.description}</span>}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Criar conta de anunciante</h2>
        {error && <Notice kind="error">{error}</Notice>}
        <form className="form" onSubmit={signup}>
          <Field label="Empresa"><input value={form.companyName} onChange={set('companyName')} required /></Field>
          <div className="form-row">
            <Field label="Seu nome"><input value={form.contactName} onChange={set('contactName')} required /></Field>
            <Field label="Telefone"><input value={form.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="E-mail"><input type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></Field>
          <Field label="Senha">
            <input type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} required />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar conta</button></div>
        </form>
      </div>
    </div>
  );
}

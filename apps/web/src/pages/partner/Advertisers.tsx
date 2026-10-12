import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Advertiser } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

const EMPTY = { name: '', contactName: '', email: '', phone: '' };

export function Advertisers() {
  const [list, setList] = useState<Advertiser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ advertisers: Advertiser[] }>('/api/partner/advertisers').then((r) => setList(r.advertisers)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      const r = await api<{ advertiser: Advertiser }>('/api/partner/advertisers', { method: 'POST', body });
      setList((l) => [...l, r.advertiser].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(EMPTY);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Anunciantes" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {list.map((a) => (
          <div className="row" key={a.id}>
            <div className="row-main">
              <div>{a.name}</div>
              <div className="row-sub">
                {[a.contactName, a.email, a.phone].filter(Boolean).join(' · ') || 'Sem contato'} ·{' '}
                {a.source === 'self_signup' ? 'autocadastro' : 'cadastro manual'}
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="row muted">Nenhum anunciante ainda. Cadastre abaixo ou divulgue sua página pública.</div>}
      </div>
      <div className="card">
        <h2>Novo anunciante</h2>
        <form className="form" onSubmit={create}>
          <Field label="Empresa"><input value={form.name} onChange={set('name')} required /></Field>
          <div className="form-row">
            <Field label="Contato"><input value={form.contactName} onChange={set('contactName')} /></Field>
            <Field label="Telefone"><input value={form.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="E-mail"><input type="email" value={form.email} onChange={set('email')} /></Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Cadastrar anunciante</button></div>
        </form>
      </div>
    </>
  );
}

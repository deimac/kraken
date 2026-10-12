import { IconAddressBook, IconId, IconMapPin, IconNotes } from '@tabler/icons-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api';
import { digits, maskDocument, maskPhone, maskZip } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser, AdvertiserDetail, PersonType } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const TEXT_FIELDS = ['name', 'legalName', 'contactName', 'email', 'phone', 'whatsapp', 'zip', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type FormState = Record<TextField, string> & { personType: PersonType; document: string };

const EMPTY: FormState = { personType: 'pj', document: '', ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, ''])) as Record<TextField, string>) };

function fromAdvertiser(a: Advertiser): FormState {
  const f = { ...EMPTY, personType: a.personType, document: a.document ? maskDocument(a.personType, a.document) : '' };
  for (const k of TEXT_FIELDS) f[k] = a[k] ?? '';
  if (f.zip) f.zip = maskZip(f.zip);
  return f;
}

/** Digits-only document/zip; empty strings are omitted on create and sent as null on update. */
function toBody(f: FormState, editing: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { personType: f.personType };
  const doc = digits(f.document);
  if (doc) body.document = doc;
  for (const k of TEXT_FIELDS) {
    let v = f[k].trim();
    if (k === 'zip') v = digits(v);
    if (k === 'legalName' && f.personType === 'pf') v = '';
    if (v) body[k] = v;
    else if (editing && k !== 'name') body[k] = null;
  }
  return body;
}

export function AdvertiserForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<AdvertiserDetail>(`/api/partner/advertisers/${id}`).then((r) => setForm(fromAdvertiser(r.advertiser))).catch((e) => setError(errorMessage(e)));
  }, [id]);

  const set = (k: keyof FormState, mask?: (v: string) => string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: mask ? mask(e.target.value) : e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ advertiser: Advertiser }>(editing ? `/api/partner/advertisers/${id}` : '/api/partner/advertisers', {
        method: editing ? 'PATCH' : 'POST',
        body: toBody(form, editing),
      });
      navigate(`/parceiro/anunciantes/${r.advertiser.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const pf = form.personType === 'pf';
  return (
    <>
      <PageHeader title={editing ? 'Editar anunciante' : 'Novo anunciante'} />
      {error && <Notice kind="error">{error}</Notice>}
      <form className="card form form-wide" onSubmit={submit}>
        <fieldset className="form-section">
          <legend><IconId size={18} />Identificação</legend>
          <div className="form-row">
            <Field label="Tipo">
              <select
                value={form.personType}
                onChange={(e) => setForm((f) => ({ ...f, personType: e.target.value as PersonType, document: maskDocument(e.target.value as PersonType, f.document) }))}
              >
                <option value="pj">Empresa (CNPJ)</option>
                <option value="pf">Pessoa física (CPF)</option>
              </select>
            </Field>
            <Field label={pf ? 'CPF' : 'CNPJ'}>
              <input inputMode="numeric" value={form.document} onChange={set('document', (v) => maskDocument(form.personType, v))} required={!editing} />
            </Field>
          </div>
          <div className="form-row">
            <Field label={pf ? 'Nome' : 'Nome fantasia'}><input value={form.name} onChange={set('name')} required /></Field>
            {!pf && <Field label="Razão social"><input value={form.legalName} onChange={set('legalName')} /></Field>}
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend><IconAddressBook size={18} />Contato</legend>
          <div className="form-row">
            <Field label="Pessoa de contato"><input value={form.contactName} onChange={set('contactName')} /></Field>
            <Field label="E-mail"><input type="email" value={form.email} onChange={set('email')} /></Field>
          </div>
          <div className="form-row">
            <Field label="Telefone"><input inputMode="tel" value={form.phone} onChange={set('phone', maskPhone)} /></Field>
            <Field label="WhatsApp"><input inputMode="tel" value={form.whatsapp} onChange={set('whatsapp', maskPhone)} /></Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend><IconMapPin size={18} />Endereço</legend>
          <div className="form-row-3">
            <Field label="CEP"><input inputMode="numeric" value={form.zip} onChange={set('zip', maskZip)} /></Field>
            <Field label="Rua"><input value={form.street} onChange={set('street')} /></Field>
            <Field label="Número"><input value={form.number} onChange={set('number')} /></Field>
          </div>
          <div className="form-row">
            <Field label="Complemento"><input value={form.complement} onChange={set('complement')} /></Field>
            <Field label="Bairro"><input value={form.district} onChange={set('district')} /></Field>
          </div>
          <div className="form-row">
            <Field label="Cidade"><input value={form.city} onChange={set('city')} /></Field>
            <Field label="UF">
              <select value={form.state} onChange={set('state')}>
                <option value="">—</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend><IconNotes size={18} />Observações</legend>
          <Field label="Observações internas"><textarea rows={3} value={form.notes} onChange={set('notes')} /></Field>
        </fieldset>
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>{editing ? 'Salvar alterações' : 'Cadastrar anunciante'}</button>
          <Link className="btn" to={editing ? `/parceiro/anunciantes/${id}` : '/parceiro/anunciantes'}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}

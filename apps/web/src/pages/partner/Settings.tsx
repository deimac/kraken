import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Transition } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

interface PartnerSettings {
  transition: Transition;
  transitionMs: number;
  refreshSeconds?: number;
  shuffle?: boolean;
}

/** How the establishment's TVs show the ads. TVs apply changes on their next look for new ads, without reloading. */
export function Settings() {
  const [transition, setTransition] = useState<Transition>('fade');
  const [transitionMs, setTransitionMs] = useState(600);
  const [refreshSeconds, setRefreshSeconds] = useState(300);
  const [shuffle, setShuffle] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partner: PartnerSettings }>('/api/partner')
      .then((r) => {
        setTransition(r.partner.transition);
        setTransitionMs(r.partner.transitionMs);
        setRefreshSeconds(r.partner.refreshSeconds ?? 300);
        setShuffle(r.partner.shuffle ?? true);
      })
      .catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/partner/settings', { method: 'PATCH', body: { transition, transitionMs, refreshSeconds, shuffle } });
      setMsg({ kind: 'ok', text: 'Configurações salvas. As TVs aplicam na próxima busca por anúncios.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Configurações" />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <h2>Exibição na TV</h2>
        <form className="form" onSubmit={save}>
          <Field label="Transição entre anúncios">
            <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
              <option value="fade">Esmaecer</option>
              <option value="slide">Deslizar</option>
              <option value="cut">Corte seco</option>
            </select>
          </Field>
          <Field label="Duração">
            <select value={String(transitionMs)} onChange={(e) => setTransitionMs(Number(e.target.value))} disabled={transition === 'cut'}>
              <option value="300">0,3 s</option>
              <option value="600">0,6 s</option>
              <option value="1000">1 s</option>
              <option value="1500">1,5 s</option>
              <option value="2000">2 s</option>
            </select>
          </Field>
          <Field label="Ordem dos anúncios">
            <select value={shuffle ? 'shuffle' : 'same'} onChange={(e) => setShuffle(e.target.value === 'shuffle')}>
              <option value="shuffle">Diferente em cada TV (recomendado)</option>
              <option value="same">Mesma ordem em todas as TVs</option>
            </select>
          </Field>
          <p className="muted" style={{ margin: 0 }}>
            Em qualquer ordem, cada assinatura aparece na proporção do seu plano e nunca duas vezes seguidas.
          </p>
          <Field label="Buscar anúncios novos a cada">
            <select value={String(refreshSeconds)} onChange={(e) => setRefreshSeconds(Number(e.target.value))}>
              <option value="15">15 segundos (testes)</option>
              <option value="30">30 segundos</option>
              <option value="60">1 minuto</option>
              <option value="300">5 minutos (recomendado)</option>
            </select>
          </Field>
          <p className="muted" style={{ margin: 0 }}>Assinaturas e peças novas aparecem nas TVs dentro desse intervalo, sem recarregar.</p>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button></div>
        </form>
      </div>
    </>
  );
}

import type { EffectiveStatus, FrequencyLevel, PieceStatus } from './types';

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  active: 'No ar',
  scheduled: 'Agendada',
  ended: 'Encerrada',
  paused: 'Pausada',
  cancelled: 'Cancelada',
};

export type Tone = 'pending' | 'active' | 'changes' | 'neutral' | 'off';
export function statusTone(s: EffectiveStatus): Tone {
  if (s === 'active') return 'active';
  if (s === 'paused') return 'pending';
  if (s === 'ended' || s === 'cancelled') return 'off';
  return 'neutral';
}

export const PIECE_STATUS_LABEL: Record<PieceStatus, string> = {
  pending_review: 'Aguardando aprovação',
  approved: 'Aprovada',
  rejected: 'Recusada',
  removed: 'Removida',
};

export const pieceName = (p: { originalName: string | null; mediaType: 'image' | 'video' }) =>
  p.originalName ?? (p.mediaType === 'video' ? 'Vídeo' : 'Imagem');

export const FREQUENCY_LABEL: Record<FrequencyLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Inclusive day range (YYYY-MM-DD) → [local midnight of start, local midnight after end). */
export function toApiRange(startDay: string, endDay: string): { startsAt: string; endsAt: string } {
  const start = new Date(`${startDay}T00:00:00`);
  const end = new Date(`${endDay}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Inverse of toApiRange, for display: last day included. */
export function lastDay(endsAt: string): string {
  const d = new Date(endsAt);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('pt-BR');
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(cents: number | null): string {
  return cents === null ? 'Sem valor definido' : BRL.format(cents / 100);
}

/** "1.234,56" → 123456; "" → null; invalid → undefined. */
export function parseMoney(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,3}(\.\d{3})+(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return undefined;
  const [int = '0', dec = ''] = t.replace(/\./g, '').split(',');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

export const digits = (v: string): string => v.replace(/\D/g, '');

/** Fills a 0-placeholder pattern with the digits of `v`, stopping when they run out. */
function applyMask(v: string, pattern: string): string {
  const d = digits(v);
  let out = '';
  let i = 0;
  for (const ch of pattern) {
    if (i >= d.length) break;
    out += ch === '0' ? d[i++] : ch;
  }
  return out;
}

export const maskDocument = (type: 'pf' | 'pj', v: string): string =>
  applyMask(v, type === 'pf' ? '000.000.000-00' : '00.000.000/0000-00');
export const maskZip = (v: string): string => applyMask(v, '00000-000');
export const maskPhone = (v: string): string => applyMask(v, digits(v).length > 10 ? '(00) 00000-0000' : '(00) 0000-0000');

/** Stored digits-only CPF/CNPJ → display form. */
export function formatDocument(d: string | null): string {
  if (!d) return '';
  return maskDocument(d.length === 11 ? 'pf' : 'pj', d);
}

export const PERIOD_LABEL: Record<number, string> = { 1: 'Mensal', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' };

/** "R$ 300,00/mês", "R$ 3.600,00/ano", "R$ 1.500,00 por 6 meses"; zero means "ask". */
export function formatPlanPrice(cents: number, months: number): string {
  if (cents === 0) return 'Sob consulta';
  const value = BRL.format(cents / 100);
  if (months === 1) return `${value}/mês`;
  if (months === 12) return `${value}/ano`;
  return `${value} por ${months} meses`;
}

export function planLimits(p: { maxVideos: number; maxImages: number; maxVideoSeconds: number }): string {
  const parts: string[] = [];
  if (p.maxVideos > 0) parts.push(`${p.maxVideos} ${p.maxVideos === 1 ? 'vídeo' : 'vídeos'} de até ${p.maxVideoSeconds} s`);
  if (p.maxImages > 0) parts.push(`${p.maxImages} ${p.maxImages === 1 ? 'imagem' : 'imagens'}`);
  return `Até ${parts.join(' · até ')}`;
}

/** 125050 → "1250,50" for editing in a money input. */
export const centsToInput = (cents: number | null): string => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));

/** YYYY-MM-DD of a local date. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Last day of a period of `months` starting on `startDay` (inclusive): 2026-11-01 + 1 month → 2026-11-30. */
export function periodEnd(startDay: string, months: number): string {
  const d = new Date(`${startDay}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return isoDay(d);
}

import type { EffectiveStatus, FrequencyLevel } from './types';

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  draft: 'Rascunho',
  pending_review: 'Aguardando aprovação',
  changes_requested: 'Correção pedida',
  approved: 'Aprovada',
  scheduled: 'Agendada',
  active: 'Ativa',
  ended: 'Encerrada',
  cancelled: 'Cancelada',
};

export type Tone = 'pending' | 'active' | 'changes' | 'neutral' | 'off';
export function statusTone(s: EffectiveStatus): Tone {
  if (s === 'pending_review') return 'pending';
  if (s === 'active' || s === 'approved') return 'active';
  if (s === 'changes_requested') return 'changes';
  if (s === 'ended' || s === 'cancelled') return 'off';
  return 'neutral';
}

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

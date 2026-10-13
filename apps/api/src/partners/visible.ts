import type { partners } from '../db/schema';

type Partner = typeof partners.$inferSelect;

/** A partner row as the panel may see it: never the TV code hash, only whether a valid code exists. */
export function visiblePartner(p: Partner) {
  const { tvCodeHash, tvCodeExpiresAt, ...rest } = p;
  return { ...rest, tvCodeSet: tvCodeHash !== null && tvCodeExpiresAt !== null && tvCodeExpiresAt > new Date(), tvCodeExpiresAt };
}

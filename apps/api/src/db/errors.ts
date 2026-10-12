type PgError = { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;

// Postgres unique_violation, possibly wrapped by drizzle in `cause`.
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as PgError;
  const hit = e?.code === '23505' ? e : e?.cause?.code === '23505' ? e.cause : null;
  if (!hit) return false;
  return constraint === undefined || hit.constraint === constraint;
}

/**
 * Extract the Postgres SQLSTATE code from a thrown query error.
 *
 * drizzle-orm >= 0.44 no longer rethrows the driver's error: every failed query
 * is wrapped in a `DrizzleQueryError` whose own `code` is undefined and whose
 * `cause` is the original `postgres.PostgresError`. Call sites that classify a
 * failure by SQLSTATE (23505 unique_violation, 23503 foreign_key_violation,
 * 23001 restrict_violation) therefore MUST NOT read `e.code` directly — under
 * the wrapper that silently reads `undefined`, the classification falls through,
 * and a mapped 409 turns back into a raw 500.
 *
 * The cause chain is walked rather than unwrapped one level, so this keeps
 * working whether a driver error arrives wrapped, double-wrapped, or bare.
 */
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when `e` is a Postgres error carrying any of the given SQLSTATE codes. */
export function isPgError(e: unknown, ...codes: string[]): boolean {
  const code = pgErrorCode(e);
  return code !== undefined && codes.includes(code);
}

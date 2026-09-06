/** The subset of a `feoh_import_rules` row the matcher needs. Pure; no DB. */
export interface MatchableRule {
  id: string;
  pattern: string;
  priority: number;
  enabled: boolean;
}

/** `(priority ASC, id ASC)` — deterministic, so two rules matching one payee never coin-flip. */
export function orderRules<T extends MatchableRule>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** First ENABLED rule whose pattern is a case-insensitive substring of the payee, or null. */
export function matchRule<T extends MatchableRule>(payee: string, rules: readonly T[]): T | null {
  const hay = payee.toLowerCase();
  for (const rule of orderRules(rules)) {
    if (!rule.enabled) continue;
    if (hay.includes(rule.pattern.toLowerCase())) return rule;
  }
  return null;
}

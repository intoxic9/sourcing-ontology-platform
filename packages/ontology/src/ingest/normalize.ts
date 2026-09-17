const LEGAL_SUFFIX_RE =
  /\s+(g\.?\s*m\.?\s*b\.?\s*h\.?|gmbh|ltd\.?|limited|inc\.?|corp\.?|co\.?|kg|ag|s\.?\s*a\.?)\s*$/i;

/** Collapses internal whitespace; does not trim legal suffixes (those stay in legalName). */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** For blocking / ER only — strips common legal suffix variants and case-folds. */
export function normalizeLegalNameForMatch(value: string): string {
  let name = collapseWhitespace(value).toLowerCase();
  for (let i = 0; i < 3; i += 1) {
    const next = name.replace(LEGAL_SUFFIX_RE, '').trim();
    if (next === name) break;
    name = next;
  }
  return name.replace(/\./g, '').replace(/\s+/g, ' ');
}

export function normalizeCountry(value: string): string {
  return collapseWhitespace(value).toUpperCase();
}

export function normalizeSourceKey(value: string): string {
  return collapseWhitespace(value);
}

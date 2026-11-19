/** Text helpers: cleaning names and comparing them (similar to PostgreSQL pg_trgm). */

/** Trims, collapses spaces and Unicode-normalizes a display name. Never invents text. */
export function cleanName(value: string | undefined | null): string | null {
  if (value == null) return null;
  const cleaned = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Comparison key: lowercase, no accents, punctuation as spaces. */
export function nameKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (const word of nameKey(value).split(' ').filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) result.add(padded.slice(i, i + 3));
  }
  return result;
}

/** 0..1, like pg_trgm similarity(). */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = trigrams(a ?? '');
  const tb = trigrams(b ?? '');
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** "A;B; C" → ["A","B","C"] (OSM multi-value convention). */
export function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((part) => cleanName(part))
    .filter((part): part is string => !!part);
}

export function uniqueStrings(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const key = nameKey(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

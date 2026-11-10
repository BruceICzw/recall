/** Tokenisation shared by keyword search and highlighting. Pure. */

export const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have he her his i if in into is it its me my of on or our she so ' +
    'than that the their them then there these they this those to was we were what when where which who why will ' +
    'with you your yours do does did can could would should about also just not no yes how all any some'
  ).split(' '),
);

/**
 * Words people use to *describe* a memory search that rarely appear in the target page.
 * Removed from the keyword query (not from the semantic query).
 */
export const QUERY_FILLER = new Set(
  (
    'find show give get search look looking remember recall saw seen see visited visit read reading found ' +
    'website websites site sites page pages webpage web link url thing stuff something somewhere ' +
    'once earlier recently ago back please again'
  ).split(' '),
);

/** Lowercase, strip diacritics, split on non-alphanumerics. Keeps tokens ≥ 2 chars (or digits). */
export function tokenize(text: string): string[] {
  const norm = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const out: string[] = [];
  for (const raw of norm.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Very light English stemmer: enough to match plurals and common suffixes. */
const STEM_EXCEPTIONS = new Set(['saas', 'paas', 'iaas', 'news', 'series', 'species', 'always', 'perhaps', 'whatsapp', 'aws', 'macos', 'ios']);

export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word) || STEM_EXCEPTIONS.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('sis') || word.endsWith('xis')) return word;
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

export function queryTokens(text: string): string[] {
  const toks = tokenize(text).filter((t) => !STOPWORDS.has(t) && !QUERY_FILLER.has(t));
  return [...new Set(toks)];
}

/** Bounded Levenshtein distance; returns max+1 when exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

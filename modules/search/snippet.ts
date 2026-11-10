/** Snippet selection and highlight segmentation. Pure. */
import { stem, tokenize } from '../text/tokenize';

/**
 * Pick the window of `size` characters in `text` with the densest query-term coverage.
 * Falls back to the beginning of the text.
 */
export function bestSnippet(text: string, terms: string[], size = 260): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= size) return t;
  const set = new Set(terms);
  if (!set.size) return trimWindow(t, 0, size);

  // positions of matching words
  const hits: { pos: number; term: string }[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const tok = tokenize(m[0])[0];
    if (tok && set.has(tok)) hits.push({ pos: m.index, term: tok });
  }
  if (!hits.length) return trimWindow(t, 0, size);

  let bestStart = hits[0].pos;
  let bestScore = -1;
  let j = 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < hits.length; i++) {
    counts.set(hits[i].term, (counts.get(hits[i].term) ?? 0) + 1);
    while (hits[i].pos - hits[j].pos > size * 0.8) {
      const c = counts.get(hits[j].term)! - 1;
      if (c) counts.set(hits[j].term, c);
      else counts.delete(hits[j].term);
      j++;
    }
    const score = counts.size * 10 + (i - j);
    if (score > bestScore) {
      bestScore = score;
      bestStart = hits[j].pos;
    }
  }
  const start = Math.max(0, bestStart - Math.floor(size * 0.2));
  return trimWindow(t, start, size);
}

function trimWindow(t: string, start: number, size: number): string {
  let s = start;
  if (s > 0) {
    // start at a sentence or word boundary
    const sentence = t.lastIndexOf('. ', s + 40);
    if (sentence >= s - 60 && sentence < s + 40 && sentence > 0) s = sentence + 2;
    else {
      const sp = t.indexOf(' ', s);
      s = sp >= 0 && sp - s < 20 ? sp + 1 : s;
    }
  }
  let e = Math.min(t.length, s + size);
  if (e < t.length) {
    const sp = t.lastIndexOf(' ', e);
    if (sp > s + size * 0.6) e = sp;
  }
  return `${s > 0 ? '…' : ''}${t.slice(s, e).trim()}${e < t.length ? '…' : ''}`;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Split text into segments, marking words whose stem is one of `terms`. */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  const set = new Set(terms);
  if (!set.size) return [{ text, match: false }];
  const out: HighlightSegment[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const norm = m[0]
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '');
    if (!set.has(stem(norm))) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
    out.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}

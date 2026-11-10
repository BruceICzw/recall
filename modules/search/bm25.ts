/**
 * In-memory BM25F-style keyword index over pages. Pure.
 * Fields are weighted (title > description/url > content) and the index supports
 * incremental add/remove plus typo/prefix expansion of query terms.
 */
import { contentTokens, editDistance } from '../text/tokenize';

export interface KeywordDoc {
  id: string;
  title: string;
  description: string;
  url: string;
  content: string;
}

const FIELD_WEIGHTS = { title: 3, description: 1.5, url: 2, content: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;
const FIELDS = Object.keys(FIELD_WEIGHTS) as Field[];

const K1 = 1.2;
const B = 0.75;

interface Posting {
  /** weighted term frequency */
  wtf: number;
}

export class KeywordIndex {
  private postings = new Map<string, Map<string, Posting>>();
  private docLen = new Map<string, number>();
  private docTerms = new Map<string, string[]>();
  private totalLen = 0;
  private sortedVocab: string[] | null = null;

  get size(): number {
    return this.docLen.size;
  }

  has(id: string): boolean {
    return this.docLen.has(id);
  }

  add(doc: KeywordDoc): void {
    if (this.docLen.has(doc.id)) this.remove(doc.id);
    const tf = new Map<string, number>();
    let len = 0;
    for (const f of FIELDS) {
      const raw = f === 'url' ? urlText(doc.url) : doc[f];
      const toks = contentTokens(raw ?? '');
      len += toks.length * (f === 'content' ? 1 : 0.5);
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + FIELD_WEIGHTS[f]);
    }
    for (const [t, wtf] of tf) {
      let p = this.postings.get(t);
      if (!p) {
        p = new Map();
        this.postings.set(t, p);
        this.sortedVocab = null;
      }
      p.set(doc.id, { wtf });
    }
    const L = Math.max(1, len);
    this.docLen.set(doc.id, L);
    this.docTerms.set(doc.id, [...tf.keys()]);
    this.totalLen += L;
  }

  remove(id: string): void {
    const terms = this.docTerms.get(id);
    if (!terms) return;
    for (const t of terms) {
      const p = this.postings.get(t);
      if (!p) continue;
      p.delete(id);
      if (p.size === 0) {
        this.postings.delete(t);
        this.sortedVocab = null;
      }
    }
    this.totalLen -= this.docLen.get(id) ?? 0;
    this.docLen.delete(id);
    this.docTerms.delete(id);
  }

  /** Expand a query term to indexed terms: exact, prefix (≥4 chars) and edit-distance-1/2 typos. */
  expand(term: string): { term: string; weight: number }[] {
    const out: { term: string; weight: number }[] = [];
    if (this.postings.has(term)) out.push({ term, weight: 1 });
    const vocab = this.vocab();
    if (term.length >= 4) {
      // prefix matches via binary search on sorted vocabulary
      let lo = 0;
      let hi = vocab.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (vocab[mid] < term) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < vocab.length && vocab[i].startsWith(term) && out.length < 12; i++) {
        if (vocab[i] !== term) out.push({ term: vocab[i], weight: 0.6 });
      }
    }
    if (out.length === 0 && term.length >= 5) {
      const max = term.length >= 8 ? 2 : 1;
      const cands: { term: string; d: number }[] = [];
      for (const v of vocab) {
        if (Math.abs(v.length - term.length) > max || v[0] !== term[0]) continue;
        const d = editDistance(term, v, max);
        if (d <= max) cands.push({ term: v, d });
      }
      cands
        .sort((a, b) => a.d - b.d || (this.postings.get(b.term)!.size - this.postings.get(a.term)!.size))
        .slice(0, 5)
        .forEach((c) => out.push({ term: c.term, weight: c.d === 1 ? 0.7 : 0.45 }));
    }
    return out;
  }

  /** Returns raw BM25 scores per doc id, plus which query terms matched (for coverage). */
  search(terms: string[], restrictTo?: Set<string>): Map<string, { score: number; matched: number }> {
    const N = this.docLen.size;
    const avgdl = N ? this.totalLen / N : 1;
    const scores = new Map<string, { score: number; matched: number }>();
    for (const qt of terms) {
      const seenForTerm = new Set<string>();
      for (const { term, weight } of this.expand(qt)) {
        const p = this.postings.get(term);
        if (!p) continue;
        const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
        for (const [id, { wtf }] of p) {
          if (restrictTo && !restrictTo.has(id)) continue;
          const dl = this.docLen.get(id) ?? avgdl;
          const s = (idf * (wtf * (K1 + 1))) / (wtf + K1 * (1 - B + (B * dl) / avgdl));
          const cur = scores.get(id) ?? { score: 0, matched: 0 };
          cur.score += s * weight;
          if (!seenForTerm.has(id)) {
            cur.matched += weight >= 0.6 ? 1 : 0.5;
            seenForTerm.add(id);
          }
          scores.set(id, cur);
        }
      }
    }
    return scores;
  }

  private vocab(): string[] {
    if (!this.sortedVocab) this.sortedVocab = [...this.postings.keys()].sort();
    return this.sortedVocab;
  }
}

function urlText(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')} ${decodeURIComponent(u.pathname)}`.replace(/[-_/.]+/g, ' ');
  } catch {
    return url;
  }
}

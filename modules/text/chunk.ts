/** Sentence-aware chunking. Pure. */

export interface ChunkOptions {
  /** Target characters per chunk. MiniLM truncates at 256 tokens (~1000 chars). */
  targetChars: number;
  /** Hard cap; longer sentences are split on word boundaries. */
  maxChars: number;
  /** Characters of trailing context carried into the next chunk. */
  overlapChars: number;
  /** Cap on chunks per page to bound indexing cost for very long pages. */
  maxChunks: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 700,
  maxChars: 1000,
  overlapChars: 120,
  maxChunks: 48,
};

/** Split text into sentences (keeps terminal punctuation). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    // Split after . ! ? … followed by whitespace + capital/digit/quote, avoiding common abbreviations.
    const parts = p.split(/(?<=(?<!\b(?:e\.g|i\.e|Mr|Mrs|Ms|Dr|Prof|vs|etc|Inc|Ltd|St|No))[.!?…])\s+(?=["'“(\[]?[A-Z0-9])/);
    for (const s of parts) {
      const t = s.trim();
      if (t) out.push(t);
    }
    // Paragraph boundary marker so chunks prefer to end at paragraphs.
    out.push('\n');
  }
  if (out[out.length - 1] === '\n') out.pop();
  return out;
}

function splitLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const words = sentence.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      out.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
    } else {
      cur = cur ? `${cur} ${w}` : w.slice(0, maxChars);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function tail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return chars <= 0 ? '' : text;
  const slice = text.slice(text.length - chars);
  const sp = slice.indexOf(' ');
  return sp >= 0 ? slice.slice(sp + 1) : slice;
}

export function chunkText(text: string, opts: Partial<ChunkOptions> = {}): string[] {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
  const units = splitSentences(text).flatMap((s) => (s === '\n' ? ['\n'] : splitLong(s, o.maxChars)));
  const chunks: string[] = [];
  let cur = '';
  let curHasNew = false; // whether cur contains anything beyond the carried overlap

  const flush = () => {
    const c = cur.trim();
    if (c && curHasNew) chunks.push(c);
    cur = tail(c, o.overlapChars);
    curHasNew = false;
  };

  for (const u of units) {
    if (chunks.length >= o.maxChunks) break;
    if (u === '\n') {
      // Prefer breaking at a paragraph once we're past ~60% of the target.
      if (cur.length >= o.targetChars * 0.6) flush();
      else if (cur) cur += ' ';
      continue;
    }
    if (cur.length + u.length + 1 > o.maxChars || (cur.length >= o.targetChars && curHasNew)) flush();
    cur = cur ? `${cur.trimEnd()} ${u}` : u;
    curHasNew = true;
  }
  if (chunks.length < o.maxChunks) flush();
  return chunks;
}

/** The "meta" chunk: what a metadata-only page is about. Embedded for every page. */
export function metaChunkText(title: string, description: string, url: string): string {
  let path = '';
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.pathname)
      .replace(/[-_/.+]+/g, ' ')
      .replace(/\b(html?|php|aspx?)\b/g, '')
      .trim();
    path = `${u.hostname.replace(/^www\./, '')} ${path}`.trim();
  } catch {
    path = url;
  }
  return [title, description, path].filter(Boolean).join('. ').slice(0, 1000);
}

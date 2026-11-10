/**
 * Hybrid search engine (FR-04). Runs in the search page. Keeps an incrementally-synced
 * in-memory keyword index and vector cache so repeated searches stay fast on large indexes.
 *
 * Pipeline: parse → embed query → semantic top-k chunks + BM25 → merge by page → filter → rank → snippets.
 */
import type { PageRecord, SearchFilters, SearchResponse, SearchResult } from '../../types';
import type { RecallDB } from '../../database/schema';
import { KeywordIndex } from './bm25';
import { parseQuery } from './query';
import { DEFAULT_WEIGHTS, KEYWORD_ONLY_WEIGHTS, rankPages, type PageCandidate, type RankingWeights } from './rank';
import { bestSnippet } from './snippet';
import { dot, topK } from './vector';
import { getModel } from '../embeddings/models';
import { domainMatches } from '../../utils/url';

export type QueryEmbedder = (text: string) => Promise<Float32Array | null>;

interface VecEntry {
  chunkId: string;
  pageId: string;
  vec: Float32Array;
}

const SEMANTIC_TOP_CHUNKS = 400;

export class SearchEngine {
  private keyword = new KeywordIndex();
  private vectors = new Map<string, VecEntry>(); // chunk_id → vector
  private pageChunks = new Map<string, Set<string>>(); // page_id → chunk_ids
  private lastSync = -1;
  private syncedModel = '';
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly db: RecallDB,
    private readonly embedQuery: QueryEmbedder,
    private readonly getModelId: () => Promise<string>,
    private readonly weights: RankingWeights = DEFAULT_WEIGHTS,
  ) {}

  /** Bring caches up to date with IndexedDB. Cheap when nothing changed. */
  sync(): Promise<void> {
    this.syncing ??= this.doSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    const modelId = await this.getModelId();
    if (modelId !== this.syncedModel) {
      this.vectors.clear();
      this.pageChunks.clear();
      this.keyword = new KeywordIndex();
      this.lastSync = -1;
      this.syncedModel = modelId;
    }
    const allIds = new Set(await this.db.pages.toCollection().primaryKeys());

    // Removed pages
    for (const id of [...this.pageChunks.keys()]) if (!allIds.has(id)) this.dropPage(id);
    // keyword index may contain pages without vectors
    // (cheap scan: only pages not in allIds need removal; KeywordIndex.has is O(1))

    // New pages (never synced) + pages (re)indexed since last sync.
    const changed = new Set<string>();
    for (const id of allIds) if (!this.keyword.has(id)) changed.add(id);
    const reindexed = await this.db.pages.where('indexed_at').above(this.lastSync).primaryKeys();
    for (const id of reindexed) changed.add(id);

    let maxIndexed = this.lastSync;
    const ids = [...changed];
    const BATCH = 400;
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const pages = await this.db.pages.bulkGet(slice);
      const embeds = await this.db.embeddings.where('page_id').anyOf(slice).toArray();
      for (const id of slice) this.dropVectors(id);
      for (const p of pages) {
        if (!p) continue;
        this.keyword.add({ id: p.page_id, title: p.title, description: p.description, url: p.url, content: p.content });
        if (p.indexed_at && p.indexed_at > maxIndexed) maxIndexed = p.indexed_at;
      }
      for (const e of embeds) {
        if (e.model_id !== modelId) continue;
        this.vectors.set(e.chunk_id, { chunkId: e.chunk_id, pageId: e.page_id, vec: e.vector });
        let set = this.pageChunks.get(e.page_id);
        if (!set) this.pageChunks.set(e.page_id, (set = new Set()));
        set.add(e.chunk_id);
      }
    }
    // Remove keyword docs for deleted pages that never had vectors.
    if (this.keyword.size > allIds.size) {
      // rebuild lazily – rare path (bulk deletes)
      const kw = new KeywordIndex();
      const pages = await this.db.pages.toArray();
      for (const p of pages)
        kw.add({ id: p.page_id, title: p.title, description: p.description, url: p.url, content: p.content });
      this.keyword = kw;
    }
    this.lastSync = maxIndexed;
  }

  private dropVectors(pageId: string) {
    const set = this.pageChunks.get(pageId);
    if (set) for (const c of set) this.vectors.delete(c);
    this.pageChunks.delete(pageId);
  }

  private dropPage(pageId: string) {
    this.dropVectors(pageId);
    this.keyword.remove(pageId);
  }

  get stats() {
    return { pages: this.keyword.size, vectors: this.vectors.size };
  }

  /** Page ids allowed by structural filters, or undefined for "all". */
  private async allowedPages(f: SearchFilters): Promise<Set<string> | undefined> {
    let set: Set<string> | undefined;
    const intersect = (ids: string[]) => {
      const s = new Set(ids);
      set = set ? new Set([...set].filter((x) => s.has(x))) : s;
    };
    if (f.from !== undefined || f.to !== undefined) {
      const from = f.from ?? 0;
      const to = f.to ?? Number.MAX_SAFE_INTEGER;
      // A page qualifies if *any* visit falls in range, not just the latest.
      const visitPages = await this.db.visits.where('visited_at').between(from, to, true, true).toArray();
      const ids = new Set(visitPages.map((v) => v.page_id));
      for (const id of await this.db.pages.where('last_visited_at').between(from, to, true, true).primaryKeys())
        ids.add(id);
      intersect([...ids]);
    }
    if (f.domain) {
      const ids: string[] = [];
      await this.db.pages.each((p) => {
        if (domainMatches(p.domain, f.domain!)) ids.push(p.page_id);
      });
      intersect(ids);
    }
    if (f.contentOnly) intersect(await this.db.pages.where('has_content').equals(1).primaryKeys());
    if (f.savedOnly) intersect(await this.db.saved_pages.toCollection().primaryKeys());
    return set;
  }

  async search(rawQuery: string, filters: SearchFilters = {}, now = Date.now()): Promise<SearchResponse> {
    const t0 = performance.now();
    const parsed = parseQuery(rawQuery, now);
    const applied: SearchFilters = { ...filters };
    // Date / site phrases in the query only apply when the user hasn't set explicit filters.
    if (parsed.from !== undefined && applied.from === undefined && applied.to === undefined) {
      applied.from = parsed.from;
      applied.to = parsed.to;
    }
    if (parsed.domain && !applied.domain) applied.domain = parsed.domain;

    const [modelId, , qvec] = await Promise.all([
      this.getModelId(),
      this.sync(),
      parsed.semanticText ? this.embedQuery(parsed.semanticText).catch(() => null) : Promise.resolve(null),
    ]);
    const model = getModel(modelId);
    const semanticAvailable = !!qvec && this.vectors.size > 0;
    const allowed = await this.allowedPages(applied);

    // Browsing mode: no query text, only filters (e.g. "Saved pages").
    const browseOnly = !parsed.semanticText.trim() || (parsed.terms.length === 0 && !qvec);

    const cands = new Map<string, PageCandidate & { bestChunk?: string; bestSim: number }>();
    const getCand = (pageId: string) => {
      let c = cands.get(pageId);
      if (!c) {
        c = { pageId, chunkSims: [], bm25: 0, matchedTerms: 0, lastVisitedAt: 0, bestSim: -1 };
        cands.set(pageId, c);
      }
      return c;
    };

    if (semanticAvailable && qvec) {
      // Brute-force dot product over normalised vectors (fast enough for ~100k chunks).
      const pool = allowed ? [...this.vectors.values()].filter((e) => allowed.has(e.pageId)) : this.vectors.values();
      const best = topK(pool, SEMANTIC_TOP_CHUNKS, (e) => dot(qvec, e.vec));
      for (const { item: e, score: s } of best) {
        const c = getCand(e.pageId);
        c.chunkSims.push(s);
        if (s > c.bestSim) {
          c.bestSim = s;
          c.bestChunk = e.chunkId;
        }
      }
    }

    if (parsed.terms.length) {
      for (const [id, { score, matched }] of this.keyword.search(parsed.terms, allowed)) {
        const c = getCand(id);
        c.bm25 = score;
        c.matchedTerms = matched;
      }
    }

    if (browseOnly && allowed) {
      for (const id of allowed) getCand(id);
    }

    const pageIds = [...cands.keys()];
    const pages = new Map<string, PageRecord>();
    for (const p of await this.db.pages.bulkGet(pageIds)) if (p) pages.set(p.page_id, p);
    for (const c of cands.values()) c.lastVisitedAt = pages.get(c.pageId)?.last_visited_at ?? 0;

    let ranked;
    if (browseOnly) {
      ranked = [...cands.values()]
        .filter((c) => pages.has(c.pageId))
        .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
        .slice(0, 100)
        .map((c) => ({ pageId: c.pageId, score: 0, semantic: 0, keyword: 0, recency: 1, relevance: 'low' as const }));
    } else {
      ranked = rankPages([...cands.values()].filter((c) => pages.has(c.pageId)), {
        weights: semanticAvailable ? this.weights : KEYWORD_ONLY_WEIGHTS,
        calibration: model.calibration,
        queryTermCount: Math.max(1, parsed.terms.length),
        now,
        limit: 60,
      });
    }

    // Snippets from the best-matching chunk.
    const bestChunkIds = ranked.map((r) => cands.get(r.pageId)?.bestChunk).filter(Boolean) as string[];
    const chunkText = new Map<string, string>();
    for (const ch of await this.db.chunks.bulkGet(bestChunkIds)) if (ch && ch.kind === 'content') chunkText.set(ch.chunk_id, ch.text);
    const saved = new Set(
      (await this.db.saved_pages.bulkGet(ranked.map((r) => r.pageId))).filter(Boolean).map((s) => s!.page_id),
    );

    const seenCanonical = new Set<string>();
    const results: SearchResult[] = [];
    for (const r of ranked) {
      const page = pages.get(r.pageId)!;
      const canon = page.canonical_url || page.url;
      if (seenCanonical.has(canon)) continue;
      seenCanonical.add(canon);
      const c = cands.get(r.pageId)!;
      const source =
        (c.bestChunk && chunkText.get(c.bestChunk)) ||
        (parsed.terms.length && page.content ? bestSnippet(page.content, parsed.terms, 400) : '') ||
        page.description ||
        page.content.slice(0, 400);
      results.push({
        page,
        score: r.score,
        semantic: r.semantic,
        keyword: r.keyword,
        recency: r.recency,
        relevance: r.relevance,
        snippet: source ? bestSnippet(source, parsed.terms, 260) : '',
        highlights: parsed.terms,
        saved: saved.has(r.pageId),
      });
      if (results.length >= 50) break;
    }

    return {
      results,
      semanticAvailable: semanticAvailable || browseOnly,
      tookMs: Math.round(performance.now() - t0),
      appliedFilters: applied,
      interpretedDate: parsed.dateLabel,
    };
  }
}

export async function recordSearch(db: RecallDB, query: string, resultCount: number): Promise<void> {
  const q = query.trim();
  if (!q) return;
  await db.transaction('rw', db.searches, async () => {
    await db.searches.where('query').equals(q).delete();
    await db.searches.add({ query: q, searched_at: Date.now(), result_count: resultCount });
    const count = await db.searches.count();
    if (count > 30) {
      const old = await db.searches.orderBy('searched_at').limit(count - 30).primaryKeys();
      await db.searches.bulkDelete(old);
    }
  });
}

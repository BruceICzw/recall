/** Hybrid ranking. Pure. Score = wS·S + wK·K + wR·R (PRD §9, weights to be calibrated by eval). */
import type { RelevanceLevel } from '../../types';
import { DAY } from '../../utils/time';

export interface RankingWeights {
  semantic: number;
  keyword: number;
  recency: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = { semantic: 0.65, keyword: 0.25, recency: 0.1 };
/** Used when the embedding model is unavailable (keyword fallback). */
export const KEYWORD_ONLY_WEIGHTS: RankingWeights = { semantic: 0, keyword: 0.85, recency: 0.15 };

/** Map raw cosine similarity to 0..1. Each model has its own useful range. */
export interface SimilarityCalibration {
  floor: number; // cosine at/below which a match is meaningless
  ceil: number; // cosine at/above which a match is as good as it gets
}

export interface PageCandidate {
  pageId: string;
  /** Raw cosine similarities of this page's matched chunks (any order). */
  chunkSims: number[];
  /** Raw BM25 score and matched-term count (0 if no keyword hit). */
  bm25: number;
  matchedTerms: number;
  lastVisitedAt: number;
}

export interface RankedPage {
  pageId: string;
  score: number;
  semantic: number;
  keyword: number;
  recency: number;
  relevance: RelevanceLevel;
}

export interface RankOptions {
  weights: RankingWeights;
  calibration: SimilarityCalibration;
  queryTermCount: number;
  now?: number;
  /** Half-life-ish decay for recency in days. */
  recencyDays?: number;
  limit?: number;
  minScore?: number;
}

/** Minimum normalised semantic score for a page that has no keyword match. Tune with `npm run eval`. */
export const SEMANTIC_ONLY_MIN = 0.25;

export function normalizeSimilarity(cos: number, c: SimilarityCalibration): number {
  if (!Number.isFinite(cos)) return 0;
  return Math.min(1, Math.max(0, (cos - c.floor) / (c.ceil - c.floor)));
}

/**
 * Page-level semantic score: best chunk plus a small, capped bonus for additional strong chunks.
 * Grouping by page prevents long pages with many similar chunks from dominating (PRD §9).
 */
export function pageSemanticScore(chunkSims: number[], c: SimilarityCalibration): number {
  if (!chunkSims.length) return 0;
  const sorted = chunkSims.map((s) => normalizeSimilarity(s, c)).sort((a, b) => b - a);
  const best = sorted[0];
  const support = sorted.slice(1, 3).reduce((acc, s) => acc + s, 0) / 2;
  return Math.min(1, best + 0.08 * support);
}

/** Saturating keyword score in 0..1 that rewards matching more of the query's terms. */
export function keywordScore(bm25: number, matchedTerms: number, queryTermCount: number): number {
  if (bm25 <= 0 || queryTermCount <= 0) return 0;
  const coverage = Math.min(1, matchedTerms / queryTermCount);
  // BM25's IDF collapses in small indexes (a term found in every page scores ~0.3), so a pure
  // absolute score would hide genuine matches for new users. Coverage sets a floor; BM25
  // strength ranks within it.
  const strength = 1 - Math.exp(-bm25 / 3);
  return Math.min(1, coverage ** 1.2 * (0.4 + 0.6 * strength));
}

export function recencyScore(lastVisitedAt: number, now: number, days = 45): number {
  const age = Math.max(0, (now - lastVisitedAt) / DAY);
  return Math.exp(-age / days);
}

export function relevanceLevel(score: number): RelevanceLevel {
  if (score >= 0.55) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

export function rankPages(cands: PageCandidate[], o: RankOptions): RankedPage[] {
  const now = o.now ?? Date.now();
  const w = o.weights;
  const minScore = o.minScore ?? 0.12;
  const out: RankedPage[] = [];
  for (const c of cands) {
    const S = pageSemanticScore(c.chunkSims, o.calibration);
    const K = keywordScore(c.bm25, c.matchedTerms, o.queryTermCount);
    const R = recencyScore(c.lastVisitedAt, now, o.recencyDays);
    // Require evidence of relevance; recency alone never qualifies a page. Embeddings always
    // return *some* nearest neighbour, so a page with no keyword match needs a clearly
    // meaningful semantic match (S ≥ 0.25 ≈ cosine 0.245 for MiniLM) to be shown.
    if (K < 0.12 && S < SEMANTIC_ONLY_MIN) continue;
    const score = w.semantic * S + w.keyword * K + w.recency * R;
    if (score < minScore) continue;
    out.push({ pageId: c.pageId, score, semantic: S, keyword: K, recency: R, relevance: relevanceLevel(score) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, o.limit ?? 50);
}

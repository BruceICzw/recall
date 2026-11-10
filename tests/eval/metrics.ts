/** Retrieval metrics for search-quality evaluation (PRD §15). Pure. */

export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const top = ranked.slice(0, k);
  if (!top.length) return 0;
  return top.filter((id) => relevant.has(id)).length / Math.min(k, top.length || k);
}

export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (!relevant.size) return 0;
  return ranked.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size;
}

export function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  const i = ranked.findIndex((id) => relevant.has(id));
  return i < 0 ? 0 : 1 / (i + 1);
}

/** "Top-five relevance" target from PRD §4: share of queries with a relevant page in the top 5. */
export function hitAtK(ranked: string[], relevant: Set<string>, k: number): number {
  return ranked.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0;
}

export interface EvalSummary {
  queries: number;
  precisionAt5: number;
  recallAt10: number;
  mrr: number;
  hitAt5: number;
  p95LatencyMs: number;
  meanLatencyMs: number;
}

export function summarize(
  runs: { ranked: string[]; relevant: string[]; latencyMs: number }[],
): EvalSummary {
  const n = runs.length || 1;
  const lat = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const sum = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / n;
  return {
    queries: runs.length,
    precisionAt5: sum((r) => precisionAtK(r.ranked, new Set(r.relevant), 5)),
    recallAt10: sum((r) => recallAtK(r.ranked, new Set(r.relevant), 10)),
    mrr: sum((r) => reciprocalRank(r.ranked, new Set(r.relevant))),
    hitAt5: sum((r) => hitAtK(r.ranked, new Set(r.relevant), 5)),
    p95LatencyMs: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] ?? 0,
    meanLatencyMs: sum((r) => r.latencyMs),
  };
}

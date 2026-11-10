import { describe, expect, it } from 'vitest';
import { hitAtK, precisionAtK, recallAtK, reciprocalRank, summarize } from '../eval/metrics';

describe('eval metrics', () => {
  const rel = new Set(['a', 'b']);
  it('computes P@k, R@k, RR, hit', () => {
    expect(precisionAtK(['x', 'a', 'y', 'b', 'z'], rel, 5)).toBeCloseTo(0.4, 5);
    expect(recallAtK(['x', 'a'], rel, 10)).toBeCloseTo(0.5, 5);
    expect(reciprocalRank(['x', 'y', 'b'], rel)).toBeCloseTo(1 / 3, 5);
    expect(reciprocalRank(['x'], rel)).toBe(0);
    expect(hitAtK(['x', 'y', 'z', 'w', 'v', 'a'], rel, 5)).toBe(0);
  });
  it('summarises runs', () => {
    const s = summarize([
      { ranked: ['a'], relevant: ['a'], latencyMs: 10 },
      { ranked: ['x', 'b'], relevant: ['b'], latencyMs: 30 },
    ]);
    expect(s.mrr).toBeCloseTo(0.75, 5);
    expect(s.hitAt5).toBe(1);
    expect(s.meanLatencyMs).toBe(20);
  });
});

import { describe, expect, it } from 'vitest';
import { KeywordIndex } from '../../modules/search/bm25';
import { parseQuery } from '../../modules/search/query';
import {
  DEFAULT_WEIGHTS,
  keywordScore,
  normalizeSimilarity,
  pageSemanticScore,
  rankPages,
  recencyScore,
  relevanceLevel,
} from '../../modules/search/rank';
import { bestSnippet, highlightSegments } from '../../modules/search/snippet';
import { cosine, dot, normalize, topK } from '../../modules/search/vector';
import { DAY } from '../../utils/time';

// Fixed "now": Wednesday 10 June 2026, 15:00 local time.
const NOW = new Date(2026, 5, 10, 15, 0, 0).getTime();

describe('parseQuery', () => {
  it('strips command phrasing and filler for keyword terms', () => {
    const q = parseQuery('Find that AI tutor website I visited in Zimbabwe', NOW);
    expect(q.terms).toEqual(['ai', 'tutor', 'zimbabwe']);
    expect(q.semanticText).toBe('that AI tutor website I visited in Zimbabwe');
    expect(q.from).toBe(undefined);
  });
  it('interprets "last week"', () => {
    const q = parseQuery('the react native tutorial I saw last week', NOW);
    expect(q.dateLabel).toBe('last week');
    // Monday 1 June → Monday 8 June
    expect(new Date(q.from!).getDate()).toBe(1);
    expect(new Date(q.to!).getDate()).toBe(8);
    expect(q.semanticText).toBe('the react native tutorial');
  });
  it('interprets yesterday / today / month names / years', () => {
    expect(parseQuery('pizza recipe yesterday', NOW).dateLabel).toBe('yesterday');
    expect(parseQuery('pizza recipe I found today', NOW).dateLabel).toBe('today');
    const march = parseQuery('payment gateways comparison in March', NOW);
    expect(march.dateLabel).toBe('March 2026');
    const dec = parseQuery('payment gateways in December', NOW);
    expect(dec.dateLabel).toBe('December 2025');
    expect(parseQuery('budget template in 2024', NOW).dateLabel).toBe('2024');
    expect(parseQuery('docs from the past 3 days', NOW).dateLabel).toBe('past 3 days');
  });
  it('extracts site: filters', () => {
    const q = parseQuery('replication guide site:www.postgresql.org', NOW);
    expect(q.domain).toBe('postgresql.org');
    expect(q.terms).toEqual(['replication', 'guide']);
  });
  it('never returns an empty semantic query', () => {
    expect(parseQuery('yesterday', NOW).semanticText).toBe('yesterday');
  });
});

describe('KeywordIndex (BM25)', () => {
  const idx = new KeywordIndex();
  idx.add({ id: 'a', title: 'Deploying Next.js with PM2', description: '', url: 'https://blog.dev/nextjs-pm2', content: 'Use pm2 to keep your Next.js server running in production on Ubuntu.' });
  idx.add({ id: 'b', title: 'Vector databases explained', description: 'How embeddings are stored', url: 'https://x.io/vectors', content: 'A vector database indexes embeddings for similarity search.' });
  idx.add({ id: 'c', title: 'Homemade pizza', description: '', url: 'https://food.com/pizza', content: 'Knead the dough, add tomato sauce and mozzarella.' });

  it('ranks the matching document first', () => {
    const r = idx.search(['vector', 'database']);
    const best = [...r.entries()].sort((x, y) => y[1].score - x[1].score)[0];
    expect(best[0]).toBe('b');
    expect(best[1].matched).toBe(2);
  });
  it('tolerates typos', () => {
    const r = idx.search(['mozarella']);
    expect(r.has('c')).toBe(true);
  });
  it('matches prefixes', () => {
    expect(idx.search(['deploy']).has('a')).toBe(true);
  });
  it('supports removal and restriction', () => {
    expect(idx.search(['pizza'], new Set(['a'])).size).toBe(0);
    idx.remove('c');
    expect(idx.search(['pizza']).size).toBe(0);
    expect(idx.size).toBe(2);
  });
  it('re-adding replaces the document', () => {
    idx.add({ id: 'a', title: 'Something else', description: '', url: 'https://blog.dev/x', content: 'nothing relevant' });
    expect(idx.search(['pm2']).has('a')).toBe(false);
  });
});

describe('ranking', () => {
  const cal = { floor: 0.12, ceil: 0.62 };
  it('normalises similarity into 0..1', () => {
    expect(normalizeSimilarity(0.05, cal)).toBe(0);
    expect(normalizeSimilarity(0.37, cal)).toBeCloseTo(0.5, 5);
    expect(normalizeSimilarity(0.9, cal)).toBe(1);
  });
  it('page semantic score is dominated by the best chunk, with a capped bonus', () => {
    const one = pageSemanticScore([0.5], cal);
    const many = pageSemanticScore([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], cal);
    expect(many).toBeGreaterThan(one);
    expect(many - one).toBeLessThan(0.1); // grouping prevents many-chunk pages from dominating
  });
  it('keyword score rewards coverage and saturates', () => {
    expect(keywordScore(10, 3, 3)).toBeGreaterThan(keywordScore(10, 1, 3));
    expect(keywordScore(1000, 3, 3)).toBeLessThanOrEqual(1);
    expect(keywordScore(0, 0, 3)).toBe(0);
  });
  it('keeps full-coverage matches above the noise threshold in tiny indexes', () => {
    // one-page index: IDF ≈ 0.29, so raw BM25 is tiny
    expect(keywordScore(0.29, 1, 1)).toBeGreaterThan(0.4);
  });
  it('recency decays', () => {
    expect(recencyScore(NOW, NOW)).toBe(1);
    expect(recencyScore(NOW - 45 * DAY, NOW)).toBeCloseTo(Math.exp(-1), 5);
  });
  it('combines S, K and R with the PRD weights and filters noise', () => {
    const ranked = rankPages(
      [
        { pageId: 'semantic', chunkSims: [0.6], bm25: 0, matchedTerms: 0, lastVisitedAt: NOW - 60 * DAY },
        { pageId: 'keyword', chunkSims: [0.2], bm25: 8, matchedTerms: 2, lastVisitedAt: NOW },
        { pageId: 'noise', chunkSims: [0.1], bm25: 0, matchedTerms: 0, lastVisitedAt: NOW },
      ],
      { weights: DEFAULT_WEIGHTS, calibration: cal, queryTermCount: 3, now: NOW },
    );
    expect(ranked.map((r) => r.pageId)).toEqual(['semantic', 'keyword']);
    const s = ranked[0];
    expect(s.score).toBeCloseTo(0.65 * s.semantic + 0.25 * s.keyword + 0.1 * s.recency, 6);
  });
  it('drops weak semantic-only neighbours (nonsense queries return nothing)', () => {
    const ranked = rankPages(
      [
        { pageId: 'weak', chunkSims: [0.2], bm25: 0, matchedTerms: 0, lastVisitedAt: NOW },
        { pageId: 'ok', chunkSims: [0.3], bm25: 0, matchedTerms: 0, lastVisitedAt: NOW },
      ],
      { weights: DEFAULT_WEIGHTS, calibration: cal, queryTermCount: 1, now: NOW },
    );
    expect(ranked.map((r) => r.pageId)).toEqual(['ok']);
  });
  it('relevance levels', () => {
    expect(relevanceLevel(0.7)).toBe('high');
    expect(relevanceLevel(0.4)).toBe('medium');
    expect(relevanceLevel(0.2)).toBe('low');
  });
});

describe('snippets', () => {
  const text =
    'Intro paragraph about nothing in particular that goes on for a while. '.repeat(6) +
    'Here we finally explain how a vector database stores embeddings for search. ' +
    'Closing remarks that are also not relevant at all to the topic. '.repeat(6);
  it('centres on the densest region of matches', () => {
    const s = bestSnippet(text, ['vector', 'database', 'embedding']);
    expect(s).toContain('vector database stores embeddings');
    expect(s.length).toBeLessThanOrEqual(262);
  });
  it('falls back to the start', () => {
    expect(bestSnippet(text, ['zzz']).startsWith('Intro paragraph')).toBe(true);
  });
  it('highlights stemmed matches', () => {
    const segs = highlightSegments('Vector databases store embeddings.', ['database', 'embedding']);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['databases', 'embeddings']);
    expect(segs.map((s) => s.text).join('')).toBe('Vector databases store embeddings.');
  });
});

describe('vectors', () => {
  it('normalised dot equals cosine', () => {
    const a = normalize(Float32Array.from([1, 2, 3]));
    const b = normalize(Float32Array.from([2, 1, 0]));
    expect(dot(a, b)).toBeCloseTo(cosine([1, 2, 3], [2, 1, 0]), 5);
  });
  it('topK returns the best k in order', () => {
    const r = topK([5, 1, 9, 3, 7, 2], 3, (x) => x);
    expect(r.map((x) => x.item)).toEqual([9, 7, 5]);
    expect(topK([1, 2], 5, (x) => x).map((x) => x.item)).toEqual([2, 1]);
  });
});

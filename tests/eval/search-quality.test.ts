/**
 * Search-quality evaluation (PRD §15). Runs the real ingest → embed → hybrid-search pipeline
 * over tests/eval/dataset.json and reports Precision@5, Recall@10, MRR, Hit@5 and latency.
 *
 *   npm run eval                    # keyword-only baseline (no model download)
 *   RECALL_EVAL_MODEL=1 npm run eval   # with the real model (downloads ~23 MB once)
 *   RECALL_EVAL_MODEL=Xenova/multilingual-e5-small npm run eval
 * On Windows PowerShell: $env:RECALL_EVAL_MODEL="1"; npm run eval
 */
import { describe, expect, it } from 'vitest';
import dataset from './dataset.json';
import { summarize } from './metrics';
import { db } from '../../database/schema';
import { getSettings, updateSettings } from '../../database/settings';
import { ingestCapture } from '../../modules/indexing/pipeline';
import { processQueue } from '../../modules/indexing/queue';
import { SearchEngine } from '../../modules/search/engine';
import { getModel } from '../../modules/embeddings/models';
import type { EmbeddingProvider } from '../../modules/embeddings/provider';
import { pageIdFor } from '../../utils/url';

const MODEL_FLAG = process.env.RECALL_EVAL_MODEL;

async function nodeProvider(modelId: string): Promise<EmbeddingProvider> {
  const { pipeline } = await import('@huggingface/transformers');
  const model = getModel(modelId);
  const extractor: any = await pipeline('feature-extraction', model.id, { dtype: 'q8' } as any);
  return {
    model,
    source: 'downloaded',
    device: 'node',
    load: async () => {},
    dispose: async () => {},
    embed: async (texts, kind) => {
      const prefix = kind === 'query' ? model.queryPrefix : model.passagePrefix;
      const res = await extractor(texts.map((t) => prefix + t), { pooling: 'mean', normalize: true });
      const dims = res.dims[res.dims.length - 1];
      return texts.map((_, i) => res.data.slice(i * dims, (i + 1) * dims) as Float32Array);
    },
  };
}

describe('search quality', () => {
  it(
    'meets PRD relevance targets on the evaluation set',
    async () => {
      await Promise.all(db.tables.map((t) => t.clear()));
      const modelId = MODEL_FLAG && MODEL_FLAG !== '1' ? MODEL_FLAG : 'Xenova/all-MiniLM-L6-v2';
      await updateSettings({ embeddingModel: modelId });
      const settings = await getSettings();
      const idMap = new Map<string, string>();
      for (const p of dataset.pages) {
        idMap.set(pageIdFor(p.url), p.id);
        await ingestCapture({ url: p.url, title: p.title, description: '', content: p.content, status: 'extracted' }, settings);
      }

      let embedQuery: (q: string) => Promise<Float32Array | null> = async () => null;
      if (MODEL_FLAG) {
        const provider = await nodeProvider(modelId);
        await processQueue(async () => provider);
        embedQuery = async (q) => (await provider.embed([q], 'query'))[0];
      }

      const engine = new SearchEngine(db, embedQuery, async () => modelId);
      await engine.sync();
      const runs: { ranked: string[]; relevant: string[]; latencyMs: number }[] = [];
      for (const { q, relevant } of dataset.queries) {
        const t0 = performance.now();
        const res = await engine.search(q);
        const latencyMs = performance.now() - t0;
        const ranked = res.results.map((r) => idMap.get(r.page.page_id)!);
        runs.push({ ranked, relevant, latencyMs });
        if (process.env.RECALL_EVAL_VERBOSE) console.log(`${q}\n   → ${ranked.slice(0, 5).join(', ')}`);
      }
      const s = summarize(runs);
      console.table({ mode: MODEL_FLAG ? `hybrid (${modelId})` : 'keyword only', ...s });

      // Keyword-only is a floor; the hybrid target is the PRD's 80% top-5 relevance.
      expect(s.hitAt5).toBeGreaterThanOrEqual(MODEL_FLAG ? 0.8 : 0.6);
      expect(s.p95LatencyMs).toBeLessThan(2000);
    },
    10 * 60_000,
  );
});

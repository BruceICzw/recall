/**
 * Embedding job processor. Runs in the offscreen document. All state lives in IndexedDB,
 * so if the document or browser dies mid-job the work is simply picked up again (resumable).
 */
import type { EmbeddingProvider } from '../embeddings/provider';
import { db, isQuotaError } from '../../database/schema';
import { nextPendingJob, resetStaleJobs } from '../../database/chunks';
import { getSettings, updateSettings } from '../../database/settings';

export const MAX_ATTEMPTS = 3;

export interface QueueRunOptions {
  /** Stop after this many ms so the document can yield (it is re-poked by the background alarm). */
  budgetMs?: number;
  onProgress?: (done: number) => void;
  shouldStop?: () => boolean;
}

export async function processQueue(
  getProvider: (modelId: string) => Promise<EmbeddingProvider>,
  opts: QueueRunOptions = {},
): Promise<{ processed: number; failed: number; stoppedReason: string }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  let processed = 0;
  let failed = 0;
  await resetStaleJobs();

  while (true) {
    if (opts.shouldStop?.()) return { processed, failed, stoppedReason: 'stopped' };
    if (Date.now() - started > budget) return { processed, failed, stoppedReason: 'budget' };
    const settings = await getSettings();
    if (settings.indexingPaused) return { processed, failed, stoppedReason: 'paused' };

    const job = await nextPendingJob();
    if (!job) return { processed, failed, stoppedReason: 'empty' };

    // Load the model before claiming so a model failure never counts against a job.
    let provider: EmbeddingProvider;
    try {
      provider = await getProvider(settings.embeddingModel);
    } catch (err) {
      console.warn('[Recall] embedding model unavailable', err);
      return { processed, failed, stoppedReason: 'model_error' };
    }

    // Claim the job.
    const claimed = await db.indexing_jobs
      .where('id')
      .equals(job.id!)
      .and((j) => j.status === 'pending')
      .modify({ status: 'running', attempts: job.attempts + 1, updated_at: Date.now() });
    if (!claimed) continue;

    try {
      const modelId = settings.embeddingModel;
      const chunks = await db.chunks.where('page_id').equals(job.page_id).sortBy('ordinal');
      if (chunks.length) {
        const existing = await db.embeddings.bulkGet(chunks.map((c) => c.chunk_id));
        const todo = chunks.filter((c, i) => existing[i]?.model_id !== modelId);
        if (todo.length) {
          const vectors = await provider.embed(
            todo.map((c) => c.text),
            'passage',
          );
          const now = Date.now();
          // Page may have been deleted while we were embedding.
          const stillExists = await db.pages.get(job.page_id);
          if (stillExists) {
            await db.embeddings.bulkPut(
              todo.map((c, i) => ({
                chunk_id: c.chunk_id,
                page_id: c.page_id,
                model_id: modelId,
                vector: vectors[i],
                created_at: now,
              })),
            );
          }
        }
      }
      await db.transaction('rw', db.indexing_jobs, db.pages, async () => {
        await db.indexing_jobs.delete(job.id!);
        await db.pages.update(job.page_id, { indexed_at: Date.now() });
      });
      processed++;
      opts.onProgress?.(processed);
    } catch (err) {
      if (isQuotaError(err)) {
        await db.indexing_jobs.update(job.id!, { status: 'pending', updated_at: Date.now() });
        await updateSettings({ indexingPaused: true, pausedReason: 'storage_full' });
        return { processed, failed, stoppedReason: 'storage_full' };
      }
      failed++;
      const attempts = job.attempts + 1;
      await db.indexing_jobs.update(job.id!, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: String((err as Error)?.message ?? err).slice(0, 500),
        updated_at: Date.now(),
      });
    }
    // Yield to keep the document responsive (search queries share this context).
    await new Promise((r) => setTimeout(r, 0));
  }
}

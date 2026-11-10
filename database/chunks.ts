import Dexie from 'dexie';
import type { ChunkRecord, IndexingJob } from '../types';
import { db } from './schema';

export function chunkRecords(pageId: string, texts: { text: string; kind: ChunkRecord['kind'] }[]): ChunkRecord[] {
  return texts.map((t, i) => ({
    chunk_id: `${pageId}:${i}`,
    page_id: pageId,
    ordinal: i,
    kind: t.kind,
    text: t.text,
  }));
}

/** Replace all chunks (and their now-stale embeddings) for a page. */
export async function replaceChunks(pageId: string, texts: { text: string; kind: ChunkRecord['kind'] }[]): Promise<void> {
  const records = chunkRecords(pageId, texts);
  await db.transaction('rw', db.chunks, db.embeddings, async () => {
    await db.chunks.where('page_id').equals(pageId).delete();
    await db.embeddings.where('page_id').equals(pageId).delete();
    await db.chunks.bulkAdd(records);
  });
}

/** Queue (or re-queue) embedding for a page. Keeps at most one open job per page. */
export async function enqueueEmbed(pageId: string, priority: number, modelId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.indexing_jobs, async () => {
    const open = await db.indexing_jobs.where('page_id').equals(pageId).toArray();
    const running = open.find((j) => j.status === 'running');
    const stale = open.filter((j) => j !== running).map((j) => j.id!);
    if (stale.length) await db.indexing_jobs.bulkDelete(stale);
    const job: IndexingJob = {
      page_id: pageId,
      kind: 'embed',
      status: 'pending',
      priority: Math.min(priority, ...open.map((j) => j.priority)),
      attempts: 0,
      model_id: modelId,
      created_at: now,
      updated_at: now,
    };
    await db.indexing_jobs.add(job);
  });
}

export async function enqueueMany(pageIds: string[], priority: number, modelId: string): Promise<void> {
  if (!pageIds.length) return;
  const now = Date.now();
  await db.transaction('rw', db.indexing_jobs, async () => {
    await db.indexing_jobs.where('page_id').anyOf(pageIds).and((j) => j.status !== 'running').delete();
    await db.indexing_jobs.bulkAdd(
      pageIds.map((page_id) => ({
        page_id,
        kind: 'embed' as const,
        status: 'pending' as const,
        priority,
        attempts: 0,
        model_id: modelId,
        created_at: now,
        updated_at: now,
      })),
    );
  });
}

export async function nextPendingJob(): Promise<IndexingJob | undefined> {
  return db.indexing_jobs
    .where('[status+priority]')
    .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
    .first();
}

export async function hasPendingJobs(): Promise<boolean> {
  return (await db.indexing_jobs.where('status').anyOf('pending', 'running').count()) > 0;
}

/** Jobs left "running" by a killed context are returned to the queue (resumability). */
export async function resetStaleJobs(olderThanMs = 3 * 60_000): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return db.indexing_jobs
    .where('status')
    .equals('running')
    .and((j) => j.updated_at < cutoff)
    .modify({ status: 'pending' });
}

export async function retryFailedJobs(): Promise<number> {
  return db.indexing_jobs.where('status').equals('failed').modify({ status: 'pending', attempts: 0, error: undefined });
}

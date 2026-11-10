/** Page / visit persistence and cascading deletes (FR-01, FR-07). */
import type { PageRecord, VisitRecord } from '../types';
import { domainMatches, getDomain, normalizeUrl, pageIdFor } from '../utils/url';
import { cleanInline } from '../modules/text/clean';
import { db } from './schema';

export interface VisitInput {
  url: string;
  title?: string;
  visitedAt: number;
  source: VisitRecord['source'];
  visitCount?: number;
  transition?: string;
}

/**
 * Create or update the page for a visit and append a visit record.
 * Repeat visits update the existing page instead of creating duplicates.
 * Returns the page and whether it was newly created.
 */
export async function recordVisit(v: VisitInput): Promise<{ page: PageRecord; created: boolean }> {
  const page_id = pageIdFor(v.url);
  return db.transaction('rw', db.pages, db.visits, async () => {
    const existing = await db.pages.get(page_id);
    const title = cleanInline(v.title, 300);
    if (existing) {
      const patch: Partial<PageRecord> = {
        last_visited_at: Math.max(existing.last_visited_at, v.visitedAt),
        visited_at: Math.min(existing.visited_at, v.visitedAt),
        visit_count: v.source === 'import' ? Math.max(existing.visit_count, v.visitCount ?? 1) : existing.visit_count + 1,
      };
      if (title && !existing.title) patch.title = title;
      await db.pages.update(page_id, patch);
      if (v.source !== 'import') {
        await db.visits.add({ page_id, visited_at: v.visitedAt, source: v.source, transition: v.transition });
      }
      return { page: { ...existing, ...patch }, created: false };
    }
    const page: PageRecord = {
      page_id,
      url: v.url,
      canonical_url: normalizeUrl(v.url),
      title,
      description: '',
      content: '',
      domain: getDomain(v.url),
      visited_at: v.visitedAt,
      last_visited_at: v.visitedAt,
      visit_count: v.visitCount ?? 1,
      extraction_status: 'metadata',
      has_content: 0,
    };
    await db.pages.add(page);
    await db.visits.add({ page_id, visited_at: v.visitedAt, source: v.source, transition: v.transition });
    return { page, created: true };
  });
}

/** Delete a page and every dependent record. Never touches Chrome's own history. */
export async function deletePage(pageId: string): Promise<void> {
  await deletePages([pageId]);
}

export async function deletePages(pageIds: string[]): Promise<number> {
  if (!pageIds.length) return 0;
  await db.transaction(
    'rw',
    [db.pages, db.visits, db.chunks, db.embeddings, db.saved_pages, db.indexing_jobs],
    async () => {
      await db.pages.bulkDelete(pageIds);
      await db.visits.where('page_id').anyOf(pageIds).delete();
      await db.chunks.where('page_id').anyOf(pageIds).delete();
      await db.embeddings.where('page_id').anyOf(pageIds).delete();
      await db.saved_pages.bulkDelete(pageIds);
      await db.indexing_jobs.where('page_id').anyOf(pageIds).delete();
    },
  );
  return pageIds.length;
}

export async function pageIdsForDomain(domain: string): Promise<string[]> {
  const ids: string[] = [];
  await db.pages.each((p) => {
    if (domainMatches(p.domain, domain)) ids.push(p.page_id);
  });
  return ids;
}

export async function deletePagesForDomain(domain: string): Promise<number> {
  return deletePages(await pageIdsForDomain(domain));
}

/** Delete pages whose URL matches (used when the user deletes entries from Chrome history). */
export async function deletePagesForUrls(urls: string[], keepSaved: boolean): Promise<number> {
  let ids = [...new Set(urls.map(pageIdFor))];
  if (keepSaved) {
    const saved = new Set((await db.saved_pages.bulkGet(ids)).filter(Boolean).map((s) => s!.page_id));
    ids = ids.filter((id) => !saved.has(id));
  }
  return deletePages(ids);
}

/** "Clear all indexed data": wipes browsing-derived data. Settings and exclusions are kept. */
export async function clearAllData(opts: { keepSaved?: boolean } = {}): Promise<void> {
  if (opts.keepSaved) {
    const saved = new Set((await db.saved_pages.toArray()).map((s) => s.page_id));
    const ids = (await db.pages.toCollection().primaryKeys()).filter((id) => !saved.has(id));
    await deletePages(ids);
    await db.searches.clear();
    return;
  }
  await db.transaction(
    'rw',
    [db.pages, db.visits, db.chunks, db.embeddings, db.saved_pages, db.indexing_jobs, db.searches],
    async () => {
      await Promise.all([
        db.pages.clear(),
        db.visits.clear(),
        db.chunks.clear(),
        db.embeddings.clear(),
        db.saved_pages.clear(),
        db.indexing_jobs.clear(),
        db.searches.clear(),
      ]);
    },
  );
}

export async function toggleSaved(pageId: string): Promise<boolean> {
  const existing = await db.saved_pages.get(pageId);
  if (existing) {
    await db.saved_pages.delete(pageId);
    return false;
  }
  await db.saved_pages.put({ page_id: pageId, saved_at: Date.now() });
  return true;
}

export interface IndexStats {
  pages: number;
  withContent: number;
  chunks: number;
  embeddings: number;
  pendingJobs: number;
  failedJobs: number;
  saved: number;
}

export async function getIndexStats(modelId: string): Promise<IndexStats> {
  const [pages, withContent, chunks, embeddings, pendingJobs, runningJobs, failedJobs, saved] = await Promise.all([
    db.pages.count(),
    db.pages.where('has_content').equals(1).count(),
    db.chunks.count(),
    db.embeddings.where('model_id').equals(modelId).count(),
    db.indexing_jobs.where('status').equals('pending').count(),
    db.indexing_jobs.where('status').equals('running').count(),
    db.indexing_jobs.where('status').equals('failed').count(),
    db.saved_pages.count(),
  ]);
  return { pages, withContent, chunks, embeddings, pendingJobs: pendingJobs + runningJobs, failedJobs, saved };
}

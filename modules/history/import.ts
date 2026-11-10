/**
 * Chrome history integration (FR-01). Chrome's History API exposes metadata only —
 * imported pages are searchable by title/URL (keyword + meta-chunk embedding) until revisited.
 */
import type { PageRecord, VisitRecord } from '../../types';
import { db } from '../../database/schema';
import { chunkRecords, enqueueMany } from '../../database/chunks';
import { getExcludedDomains, getSettings, updateSettings } from '../../database/settings';
import { deletePagesForUrls, clearAllData } from '../../database/pages';
import { buildChunks, PRIORITY_METADATA } from '../indexing/pipeline';
import { isMetadataEligible } from '../privacy/exclusions';
import { cleanInline } from '../text/clean';
import { getDomain, normalizeUrl, pageIdFor } from '../../utils/url';
import { DAY } from '../../utils/time';

export const MAX_IMPORT = 10_000;

export async function importHistory(
  onProgress?: (done: number, total: number) => void,
): Promise<{ imported: number; skipped: number }> {
  const settings = await getSettings();
  const excluded = await getExcludedDomains();
  const items = await chrome.history.search({
    text: '',
    startTime: Date.now() - settings.historyImportDays * DAY,
    maxResults: MAX_IMPORT,
  });

  const eligible = items.filter((i) => i.url && isMetadataEligible(i.url, excluded));
  const byId = new Map<string, chrome.history.HistoryItem>();
  for (const it of eligible) {
    const id = pageIdFor(it.url!);
    const prev = byId.get(id);
    if (!prev || (it.lastVisitTime ?? 0) > (prev.lastVisitTime ?? 0)) byId.set(id, it);
  }

  const ids = [...byId.keys()];
  const BATCH = 500;
  let imported = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const existing = await db.pages.bulkGet(slice);
    const newPages: PageRecord[] = [];
    const visits: VisitRecord[] = [];
    slice.forEach((id, k) => {
      if (existing[k]) return; // already known – never overwrite captured content
      const it = byId.get(id)!;
      const ts = it.lastVisitTime ?? Date.now();
      newPages.push({
        page_id: id,
        url: it.url!,
        canonical_url: normalizeUrl(it.url!),
        title: cleanInline(it.title, 300),
        description: '',
        content: '',
        domain: getDomain(it.url!),
        visited_at: ts,
        last_visited_at: ts,
        visit_count: it.visitCount ?? 1,
        extraction_status: 'metadata',
        has_content: 0,
      });
      visits.push({ page_id: id, visited_at: ts, source: 'import' });
    });
    if (newPages.length) {
      // One transaction per batch keeps a 10k-page import to a few seconds, well inside the
      // service worker's lifetime.
      await db.transaction('rw', db.pages, db.visits, db.chunks, async () => {
        await db.pages.bulkAdd(newPages);
        await db.visits.bulkAdd(visits);
        await db.chunks.bulkPut(newPages.flatMap((p) => chunkRecords(p.page_id, buildChunks(p))));
      });
      await chrome.runtime.getPlatformInfo(); // extension API call: keeps the worker alive between batches
      await enqueueMany(
        newPages.map((p) => p.page_id),
        PRIORITY_METADATA,
        settings.embeddingModel,
      );
    }
    imported += newPages.length;
    onProgress?.(Math.min(i + BATCH, ids.length), ids.length);
  }
  await updateSettings({ historyImportedAt: Date.now() });
  return { imported, skipped: items.length - eligible.length };
}

/** Reconcile Recall when the user deletes Chrome history (PRD §12, §14). */
export async function handleHistoryRemoved(removed: chrome.history.RemovedResult): Promise<void> {
  const settings = await getSettings();
  if (!settings.syncHistoryDeletion) return;
  if (removed.allHistory) {
    await clearAllData({ keepSaved: true });
    return;
  }
  if (removed.urls?.length) await deletePagesForUrls(removed.urls, true);
}

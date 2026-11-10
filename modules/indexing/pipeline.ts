/** Capture ingestion: cleaned content → page record → chunks → embedding job (FR-02, FR-03). */
import type { CapturePayload, PageRecord, Settings } from '../../types';
import { db, isQuotaError } from '../../database/schema';
import { enqueueEmbed, replaceChunks } from '../../database/chunks';
import { recordVisit } from '../../database/pages';
import { updateSettings } from '../../database/settings';
import { cleanInline, cleanText } from '../text/clean';
import { chunkText, metaChunkText } from '../text/chunk';
import { hashString, normalizeUrl, pageIdFor } from '../../utils/url';

export const PRIORITY_CAPTURED = 0;
export const PRIORITY_METADATA = 5;
export const PRIORITY_REINDEX = 8;

/** Build chunk inputs for a page. The meta chunk is always ordinal 0. */
export function buildChunks(page: Pick<PageRecord, 'title' | 'description' | 'url' | 'content'>) {
  const out: { text: string; kind: 'meta' | 'content' }[] = [
    { text: metaChunkText(page.title, page.description, page.url), kind: 'meta' },
  ];
  if (page.content) for (const t of chunkText(page.content)) out.push({ text: t, kind: 'content' });
  return out;
}

export interface IngestResult {
  pageId: string;
  status: PageRecord['extraction_status'];
  chunks: number;
  changed: boolean;
}

export async function ingestCapture(payload: CapturePayload, settings: Settings): Promise<IngestResult> {
  try {
    return await doIngest(payload, settings);
  } catch (err) {
    if (isQuotaError(err)) {
      await updateSettings({ indexingPaused: true, pausedReason: 'storage_full' }).catch(() => {});
    }
    throw err;
  }
}

async function doIngest(payload: CapturePayload, settings: Settings): Promise<IngestResult> {
  const pageId = pageIdFor(payload.url);
  let page = await db.pages.get(pageId);
  if (!page) {
    page = (await recordVisit({ url: payload.url, title: payload.title, visitedAt: Date.now(), source: 'capture' })).page;
  }

  const title = cleanInline(payload.title, 300) || page.title;
  const description = cleanInline(payload.description, 600);
  const canonical = payload.canonical_url ? normalizeUrl(payload.canonical_url) : page.canonical_url;
  const metaOnly = settings.captureMode === 'metadata';

  let content = '';
  let status: PageRecord['extraction_status'] = payload.status;
  if (payload.status === 'extracted') {
    if (metaOnly) status = 'metadata_only';
    else content = cleanText(payload.content);
    if (!metaOnly && content.length < 40) status = 'failed';
  }
  if (status !== 'extracted') content = '';

  const contentHash = hashString(`${title}\n${description}\n${content}`);
  const unchanged = page.content_hash === contentHash && page.extraction_status === status;

  const patch: Partial<PageRecord> = {
    title,
    description,
    canonical_url: canonical,
    content,
    extraction_status: status,
    has_content: content ? 1 : 0,
    content_hash: contentHash,
    published_at: payload.published_at ?? page.published_at,
  };
  await db.pages.update(pageId, patch);
  if (unchanged) return { pageId, status, chunks: 0, changed: false };

  const chunks = buildChunks({ title, description, url: page.url, content });
  await replaceChunks(pageId, chunks);
  await enqueueEmbed(pageId, content ? PRIORITY_CAPTURED : PRIORITY_METADATA, settings.embeddingModel);
  return { pageId, status, chunks: chunks.length, changed: true };
}

/** Ensure a metadata-only page has its meta chunk and an embedding job (history import / new visits). */
export async function ensureMetaChunk(page: PageRecord, modelId: string): Promise<void> {
  const existing = await db.chunks.where('page_id').equals(page.page_id).count();
  if (existing > 0) return;
  await replaceChunks(page.page_id, buildChunks(page));
  await enqueueEmbed(page.page_id, PRIORITY_METADATA, modelId);
}

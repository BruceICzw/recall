/**
 * Integration tests for the storage + indexing + search pipeline using fake-indexeddb and a
 * deterministic fake embedder (no model download). Run with `npm test`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../database/schema';
import { clearAllData, deletePage, deletePagesForDomain, deletePagesForUrls, recordVisit, toggleSaved } from '../../database/pages';
import { getSettings, updateSettings } from '../../database/settings';
import { enqueueMany, nextPendingJob, resetStaleJobs } from '../../database/chunks';
import { ingestCapture } from '../../modules/indexing/pipeline';
import { processQueue } from '../../modules/indexing/queue';
import { SearchEngine } from '../../modules/search/engine';
import type { EmbeddingProvider } from '../../modules/embeddings/provider';
import { getModel } from '../../modules/embeddings/models';
import { contentTokens } from '../../modules/text/tokenize';
import { normalize } from '../../modules/search/vector';
import { pageIdFor } from '../../utils/url';
import { DEFAULT_SETTINGS, type CapturePayload } from '../../types';

/** Hashed bag-of-words embedder with a tiny synonym map so "semantic" matches are testable. */
const SYN: Record<string, string> = { tutor: 'learning', tutoring: 'learning', education: 'learning', school: 'learning', pie: 'pizza' };
function fakeVec(text: string): Float32Array {
  const v = new Float32Array(384);
  for (const t of contentTokens(text)) {
    const w = SYN[t] ?? t;
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % 384] += 1;
  }
  return normalize(v);
}
let embedCalls = 0;
const fakeProvider: EmbeddingProvider = {
  model: getModel(undefined),
  source: 'bundled',
  device: 'test',
  load: async () => {},
  embed: async (texts) => {
    embedCalls += texts.length;
    return texts.map(fakeVec);
  },
  dispose: async () => {},
};

function capture(url: string, title: string, content: string, extra: Partial<CapturePayload> = {}): CapturePayload {
  return { url, title, description: '', content, status: 'extracted', ...extra };
}

const LONG_AI =
  'Our platform offers personalised tutoring for students across Harare and Bulawayo. ' +
  'Learners get an AI tutor that explains maths and science step by step, aligned with the ZIMSEC syllabus. '.repeat(3);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  embedCalls = 0;
});

describe('visits and pages', () => {
  it('deduplicates repeat visits into one page', async () => {
    await recordVisit({ url: 'https://www.a.com/x#top', title: 'A', visitedAt: 1, source: 'history' });
    const { created, page } = await recordVisit({ url: 'https://a.com/x/', title: 'A', visitedAt: 5, source: 'history' });
    expect(created).toBe(false);
    expect(page.visit_count).toBe(2);
    expect(page.last_visited_at).toBe(5);
    expect(await db.pages.count()).toBe(1);
    expect(await db.visits.count()).toBe(2);
  });

  it('settings round-trip with defaults', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await updateSettings({ indexingPaused: true });
    expect((await getSettings()).indexingPaused).toBe(true);
  });
});

describe('ingest → queue → search', () => {
  it('indexes captured content and finds it by description', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://learnzim.example.co.zw/', 'LearnZim', LONG_AI), settings);
    await ingestCapture(capture('https://food.example.com/pizza', 'Homemade pizza', 'Knead the dough and bake the pizza at high heat. '.repeat(5)), settings);
    expect(await db.chunks.count()).toBeGreaterThan(2);
    expect(await db.indexing_jobs.count()).toBe(2);

    const res = await processQueue(async () => fakeProvider);
    expect(res.processed).toBe(2);
    expect(await db.indexing_jobs.count()).toBe(0);
    expect(await db.embeddings.count()).toBe(await db.chunks.count());

    const engine = new SearchEngine(db, async (q) => fakeVec(q), async () => settings.embeddingModel);
    const r = await engine.search('that AI tutor website I visited in Zimbabwe');
    expect(r.semanticAvailable).toBe(true);
    expect(r.results[0].page.title).toBe('LearnZim');
    expect(r.results[0].snippet.length).toBeGreaterThan(20);

    // Keyword fallback when the model is unavailable
    const kw = new SearchEngine(db, async () => null, async () => settings.embeddingModel);
    const r2 = await kw.search('homemade pizza dough');
    expect(r2.semanticAvailable).toBe(false);
    expect(r2.results[0].page.title).toBe('Homemade pizza');
  });

  it('does not re-chunk unchanged content and refreshes changed content', async () => {
    const settings = await getSettings();
    const p = capture('https://a.com/doc', 'Doc', 'Version one of this document talks about apples and oranges. '.repeat(4));
    expect((await ingestCapture(p, settings)).changed).toBe(true);
    expect((await ingestCapture(p, settings)).changed).toBe(false);
    const p2 = { ...p, content: 'Version two now talks about bananas instead of anything else. '.repeat(4) };
    expect((await ingestCapture(p2, settings)).changed).toBe(true);
    const chunks = await db.chunks.where('page_id').equals(pageIdFor(p.url)).toArray();
    expect(chunks.some((c) => c.text.includes('bananas'))).toBe(true);
    expect(chunks.some((c) => c.text.includes('apples'))).toBe(false);
  });

  it('metadata-only mode stores no content', async () => {
    const settings = { ...(await getSettings()), captureMode: 'metadata' as const };
    await ingestCapture(capture('https://a.com/secret', 'Title', 'Private body text that must not be stored. '.repeat(5)), settings);
    const page = await db.pages.get(pageIdFor('https://a.com/secret'));
    expect(page!.content).toBe('');
    expect(page!.extraction_status).toBe('metadata_only');
    expect((await db.chunks.toArray()).every((c) => !c.text.includes('Private body'))).toBe(true);
  });

  it('blocked pages keep metadata only', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://a.com/login', 'Sign in', '', { status: 'blocked' }), settings);
    expect((await db.pages.get(pageIdFor('https://a.com/login')))!.extraction_status).toBe('blocked');
  });

  it('pauses the queue when indexing is paused, resumes stale jobs', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://a.com/1', 'One', 'Some meaningful content about the first page goes here.'), settings);
    await updateSettings({ indexingPaused: true });
    expect((await processQueue(async () => fakeProvider)).stoppedReason).toBe('paused');
    await updateSettings({ indexingPaused: false });
    const job = await nextPendingJob();
    await db.indexing_jobs.update(job!.id!, { status: 'running', updated_at: 0 });
    expect(await nextPendingJob()).toBe(undefined);
    expect(await resetStaleJobs()).toBe(1);
    expect((await processQueue(async () => fakeProvider)).processed).toBe(1);
  });

  it('retries failing embeddings, then marks failed', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://a.com/f', 'F', 'Content that will fail to embed for testing retries.'), settings);
    const failing = { ...fakeProvider, embed: async () => Promise.reject(new Error('boom')) };
    await processQueue(async () => failing);
    const job = (await db.indexing_jobs.toArray())[0];
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(3);
  });

  it('model unavailable does not burn job attempts', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://a.com/m', 'M', 'Content waiting for the model to become available.'), settings);
    const r = await processQueue(async () => Promise.reject(new Error('model missing')));
    expect(r.stoppedReason).toBe('model_error');
    expect((await db.indexing_jobs.toArray())[0].attempts).toBe(0);
  });
});

describe('deletion', () => {
  async function seed() {
    const settings = await getSettings();
    await ingestCapture(capture('https://keep.com/a', 'Keep', 'Keep this page content around for later.'), settings);
    await ingestCapture(capture('https://docs.drop.com/b', 'Drop', 'Drop this page content when excluded.'), settings);
    await processQueue(async () => fakeProvider);
  }

  it('deleting a page removes chunks, embeddings, visits, saved and jobs', async () => {
    await seed();
    const id = pageIdFor('https://keep.com/a');
    await toggleSaved(id);
    await deletePage(id);
    for (const t of [db.chunks, db.embeddings, db.visits, db.indexing_jobs]) {
      expect(await t.where('page_id').equals(id).count()).toBe(0);
    }
    expect(await db.saved_pages.get(id)).toBe(undefined);
    expect(await db.pages.count()).toBe(1);
  });

  it('domain exclusion cleanup removes subdomains', async () => {
    await seed();
    expect(await deletePagesForDomain('drop.com')).toBe(1);
    expect((await db.pages.toArray()).map((p) => p.domain)).toEqual(['keep.com']);
  });

  it('Chrome history deletion keeps saved pages', async () => {
    await seed();
    await toggleSaved(pageIdFor('https://keep.com/a'));
    await deletePagesForUrls(['https://keep.com/a', 'https://docs.drop.com/b'], true);
    expect((await db.pages.toArray()).map((p) => p.domain)).toEqual(['keep.com']);
  });

  it('clear all wipes browsing data but keeps settings and exclusions', async () => {
    await seed();
    await updateSettings({ skipSensitiveSites: false });
    await db.excluded_domains.put({ domain: 'x.com', added_at: 1 });
    await clearAllData();
    for (const t of [db.pages, db.visits, db.chunks, db.embeddings, db.saved_pages, db.indexing_jobs, db.searches]) {
      expect(await t.count()).toBe(0);
    }
    expect((await getSettings()).skipSensitiveSites).toBe(false);
    expect(await db.excluded_domains.count()).toBe(1);
  });

  it('search engine forgets deleted pages', async () => {
    await seed();
    const engine = new SearchEngine(db, async (q) => fakeVec(q), async () => DEFAULT_SETTINGS.embeddingModel);
    expect((await engine.search('drop this page')).results.length).toBeGreaterThan(0);
    await deletePagesForDomain('drop.com');
    const r = await engine.search('drop this page');
    expect(r.results.every((x) => x.page.domain !== 'docs.drop.com')).toBe(true);
  });
});

describe('filters', () => {
  it('applies domain, saved and date filters', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://github.com/a/repo', 'Speech model repo', 'An African language speech recognition model.'), settings);
    await ingestCapture(capture('https://blog.example.com/speech', 'Speech blog', 'Speech recognition for African languages explained.'), settings);
    await processQueue(async () => fakeProvider);
    const engine = new SearchEngine(db, async (q) => fakeVec(q), async () => settings.embeddingModel);

    const byDomain = await engine.search('speech recognition', { domain: 'github.com' });
    expect(byDomain.results.map((r) => r.page.domain)).toEqual(['github.com']);

    await toggleSaved(pageIdFor('https://blog.example.com/speech'));
    const saved = await engine.search('', { savedOnly: true });
    expect(saved.results.map((r) => r.page.domain)).toEqual(['blog.example.com']);

    const future = await engine.search('speech', { from: Date.now() + 86_400_000 });
    expect(future.results.length).toBe(0);
  });

  it('model switch re-queues and search ignores stale-model vectors', async () => {
    const settings = await getSettings();
    await ingestCapture(capture('https://a.com/z', 'Z', 'Zebra crossings and road safety for children.'), settings);
    await processQueue(async () => fakeProvider);
    await enqueueMany([pageIdFor('https://a.com/z')], 8, 'Xenova/multilingual-e5-small');
    expect(await db.indexing_jobs.count()).toBe(1);
    const engine = new SearchEngine(db, async (q) => fakeVec(q), async () => 'Xenova/multilingual-e5-small');
    const r = await engine.search('zebra');
    expect(r.semanticAvailable).toBe(false); // no vectors for the new model yet → keyword fallback
    expect(r.results[0].page.title).toBe('Z');
  });
});

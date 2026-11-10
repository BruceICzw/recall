/**
 * Recall's local database (IndexedDB via Dexie). Shared by the background worker, offscreen
 * document and extension pages — all run on the same chrome-extension:// origin.
 *
 * Schema changes: add a new `this.version(n)` block in `migrations.ts` — never edit an old one.
 */
import Dexie, { type Table } from 'dexie';
import type {
  ChunkRecord,
  EmbeddingRecord,
  ExcludedDomainRecord,
  IndexingJob,
  PageRecord,
  SavedPageRecord,
  SearchRecord,
  SettingRecord,
  VisitRecord,
} from '../types';
import { applyMigrations } from './migrations';

export class RecallDB extends Dexie {
  pages!: Table<PageRecord, string>;
  visits!: Table<VisitRecord, number>;
  chunks!: Table<ChunkRecord, string>;
  embeddings!: Table<EmbeddingRecord, string>;
  saved_pages!: Table<SavedPageRecord, string>;
  searches!: Table<SearchRecord, number>;
  settings!: Table<SettingRecord, string>;
  excluded_domains!: Table<ExcludedDomainRecord, string>;
  indexing_jobs!: Table<IndexingJob, number>;

  constructor(name = 'recall') {
    super(name);
    applyMigrations(this);
  }
}

export const db = new RecallDB();

/** Tables holding browsing-derived data (cleared by "Clear all indexed data"). */
export const BROWSING_TABLES = ['pages', 'visits', 'chunks', 'embeddings', 'indexing_jobs', 'searches'] as const;

export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; inner?: { name?: string } } | null;
  return e?.name === 'QuotaExceededError' || e?.inner?.name === 'QuotaExceededError';
}

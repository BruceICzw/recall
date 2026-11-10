/** Shared domain types for Recall. */

export type ExtractionStatus =
  | 'metadata' // imported from history / not yet captured
  | 'pending' // capture requested
  | 'extracted' // readable content captured
  | 'metadata_only' // user chose metadata-only capture
  | 'unsupported' // PDF, chrome://, viewer pages, etc.
  | 'blocked' // sensitive page (password field, login path) – content skipped
  | 'failed'; // extraction error

export interface PageRecord {
  /** Stable id derived from the normalised URL. */
  page_id: string;
  url: string;
  canonical_url: string;
  title: string;
  description: string;
  /** Cleaned readable text. Empty for metadata-only records. */
  content: string;
  domain: string;
  published_at?: number;
  /** First time Recall saw this page. */
  visited_at: number;
  last_visited_at: number;
  visit_count: number;
  indexed_at?: number;
  extraction_status: ExtractionStatus;
  /** Hash of content so unchanged pages are not re-chunked. */
  content_hash?: string;
  /** 1 when content is available (Dexie can't index booleans). */
  has_content: 0 | 1;
}

export interface VisitRecord {
  id?: number;
  page_id: string;
  visited_at: number;
  source: 'import' | 'history' | 'capture';
  transition?: string;
}

export type ChunkKind = 'meta' | 'content';

export interface ChunkRecord {
  /** `${page_id}:${ordinal}` */
  chunk_id: string;
  page_id: string;
  ordinal: number;
  kind: ChunkKind;
  text: string;
}

export interface EmbeddingRecord {
  chunk_id: string;
  page_id: string;
  model_id: string;
  vector: Float32Array;
  created_at: number;
}

export interface SavedPageRecord {
  page_id: string;
  saved_at: number;
}

export interface SearchRecord {
  id?: number;
  query: string;
  searched_at: number;
  result_count: number;
}

export interface ExcludedDomainRecord {
  domain: string;
  added_at: number;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface IndexingJob {
  id?: number;
  page_id: string;
  kind: 'embed';
  status: JobStatus;
  /** Lower runs first. 0 = captured content, 5 = imported metadata. */
  priority: number;
  attempts: number;
  model_id: string;
  created_at: number;
  updated_at: number;
  error?: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface Settings {
  indexingPaused: boolean;
  pausedReason?: 'user' | 'storage_full';
  /** 'full' = readable content, 'metadata' = URL/title/description only. */
  captureMode: 'full' | 'metadata';
  skipSensitiveSites: boolean;
  /** Remove Recall records when the user deletes them from Chrome history. */
  syncHistoryDeletion: boolean;
  embeddingModel: string;
  /** Allow downloading the model from Hugging Face if it isn't bundled. */
  allowModelDownload: boolean;
  historyImportDays: number;
  onboarded: boolean;
  historyImportedAt?: number;
  /**
   * When the user agreed to the in-product disclosure (Chrome Web Store "prominent disclosure
   * and consent"). Until set, Recall records nothing: no history import, no visits, no capture.
   */
  consentedAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  indexingPaused: false,
  captureMode: 'full',
  skipSensitiveSites: true,
  syncHistoryDeletion: true,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  allowModelDownload: true,
  historyImportDays: 90,
  onboarded: false,
};

/** Payload sent from the capture script to the background worker. */
export interface CapturePayload {
  url: string;
  canonical_url?: string;
  title: string;
  description: string;
  content: string;
  published_at?: number;
  status: Extract<ExtractionStatus, 'extracted' | 'blocked' | 'failed' | 'unsupported'>;
  reason?: string;
}

export interface SearchFilters {
  from?: number;
  to?: number;
  domain?: string;
  contentOnly?: boolean;
  savedOnly?: boolean;
}

export type RelevanceLevel = 'high' | 'medium' | 'low';

export interface SearchResult {
  page: PageRecord;
  score: number;
  semantic: number;
  keyword: number;
  recency: number;
  relevance: RelevanceLevel;
  snippet: string;
  /** Terms to highlight in the snippet. */
  highlights: string[];
  saved: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
  semanticAvailable: boolean;
  tookMs: number;
  appliedFilters: SearchFilters;
  /** Human-readable note about an interpreted date phrase, e.g. "last week". */
  interpretedDate?: string;
  error?: string;
}

import type Dexie from 'dexie';

/**
 * Versioned schema. Only indexed fields are listed; other fields are stored but not indexed.
 * To change the schema add `db.version(N+1).stores({...}).upgrade(tx => ...)` below.
 */
export function applyMigrations(db: Dexie): void {
  db.version(1).stores({
    pages: 'page_id, canonical_url, domain, last_visited_at, visited_at, indexed_at, extraction_status, has_content',
    visits: '++id, page_id, visited_at',
    chunks: 'chunk_id, page_id',
    embeddings: 'chunk_id, page_id, model_id, created_at',
    saved_pages: 'page_id, saved_at',
    searches: '++id, searched_at, query',
    settings: 'key',
    excluded_domains: 'domain',
    indexing_jobs: '++id, page_id, status, [status+priority], updated_at',
  });
}

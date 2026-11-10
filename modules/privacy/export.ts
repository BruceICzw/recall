/** Data export (FR-07). Produces a JSON document of everything Recall stores. */
import { db } from '../../database/schema';

export interface ExportOptions {
  includeContent: boolean;
  includeEmbeddings: boolean;
}

export async function buildExport(opts: ExportOptions): Promise<Blob> {
  const [pages, visits, saved, searches, settings, excluded] = await Promise.all([
    db.pages.toArray(),
    db.visits.toArray(),
    db.saved_pages.toArray(),
    db.searches.toArray(),
    db.settings.toArray(),
    db.excluded_domains.toArray(),
  ]);
  const doc: Record<string, unknown> = {
    format: 'recall-export',
    version: 1,
    exported_at: new Date().toISOString(),
    counts: { pages: pages.length, visits: visits.length, saved_pages: saved.length },
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    excluded_domains: excluded.map((e) => e.domain),
    pages: opts.includeContent ? pages : pages.map(({ content: _c, ...rest }) => rest),
    visits,
    saved_pages: saved,
    searches,
  };
  if (opts.includeEmbeddings) {
    const embeddings = await db.embeddings.toArray();
    doc.embeddings = embeddings.map((e) => ({ ...e, vector: Array.from(e.vector) }));
  }
  return new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

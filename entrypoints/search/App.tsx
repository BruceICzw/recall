import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResponse } from '../../types';
import { db } from '../../database/schema';
import { getSettings } from '../../database/settings';
import { deletePage, toggleSaved } from '../../database/pages';
import { SearchEngine, recordSearch } from '../../modules/search/engine';
import { send, sendWithTimeout, type EmbedQueryResponse } from '../../services/messaging';
import { Logo } from '../../components/Logo';
import { GearIcon, XIcon } from '../../components/Icons';
import { SearchInput } from '../../components/SearchInput';
import { SearchResult } from '../../components/SearchResult';
import { EMPTY_FILTERS, SearchFilters, toSearchFilters, type FilterState } from '../../components/SearchFilters';
import { IndexingStatus } from '../../components/IndexingStatus';
import { openExtensionPage, useRecentSearches, useIndexStats, useSettings } from '../../hooks/useRecall';

async function embedQuery(text: string): Promise<Float32Array | null> {
  await send({ target: 'background', type: 'ensure-offscreen' }).catch(() => {});
  // First query may need to load the model (a few seconds; longer if it must be downloaded).
  const res = await sendWithTimeout<EmbedQueryResponse>({ target: 'offscreen', type: 'embed-query', text }, 30_000);
  return res?.ok && res.vector ? Float32Array.from(res.vector) : null;
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { q: p.get('q') ?? '', saved: p.get('saved') === '1' };
}

export default function App() {
  const engine = useMemo(() => new SearchEngine(db, embedQuery, async () => (await getSettings()).embeddingModel), []);
  const initial = readUrl();
  const [query, setQuery] = useState(initial.q);
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, savedOnly: initial.saved });
  const [ignoreDatePhrase, setIgnoreDatePhrase] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(initial.q);
  const recent = useRecentSearches(8);
  const [settings] = useSettings();
  const stats = useIndexStats(settings.embeddingModel);
  const runId = useRef(0);

  const run = useCallback(
    async (q: string, f: FilterState, noDatePhrase: boolean) => {
      const id = ++runId.current;
      const sf = toSearchFilters(f);
      if (!q.trim() && !f.savedOnly && !f.domain && f.date === 'any' && !f.contentOnly) {
        setResponse(null);
        return;
      }
      setBusy(true);
      try {
        // If the user dismissed the interpreted date chip, an explicit "all time" range overrides it.
        const res = await engine.search(q, noDatePhrase ? { ...sf, from: sf.from ?? 0 } : sf);
        if (id !== runId.current) return;
        setResponse(res);
        if (q.trim()) recordSearch(db, q, res.results.length).catch(() => {});
      } catch (err) {
        if (id === runId.current)
          setResponse({ results: [], semanticAvailable: false, tookMs: 0, appliedFilters: sf, error: String(err) });
      } finally {
        if (id === runId.current) setBusy(false);
      }
    },
    [engine],
  );

  // Sync URL + run search whenever the submitted query or filters change.
  useEffect(() => {
    const p = new URLSearchParams();
    if (submitted) p.set('q', submitted);
    if (filters.savedOnly) p.set('saved', '1');
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
    document.title = submitted ? `${submitted} — Recall` : 'Recall — Search your browsing memory';
    run(submitted, filters, ignoreDatePhrase);
  }, [submitted, filters, ignoreDatePhrase, run]);

  // Warm up: sync caches and spin up the model while the user types.
  useEffect(() => {
    engine.sync().catch(() => {});
    send({ target: 'background', type: 'ensure-offscreen' }).catch(() => {});
  }, [engine]);

  const submit = (q: string) => {
    setIgnoreDatePhrase(false);
    if (q === submitted) run(q, filters, false);
    else setSubmitted(q);
  };

  const onToggleSave = async (pageId: string) => {
    const saved = await toggleSaved(pageId);
    setResponse((r) => r && { ...r, results: r.results.map((x) => (x.page.page_id === pageId ? { ...x, saved } : x)) });
  };
  const onDelete = async (pageId: string) => {
    await deletePage(pageId);
    setResponse((r) => r && { ...r, results: r.results.filter((x) => x.page.page_id !== pageId) });
  };

  const browseMode = !submitted.trim();
  const results = response?.results ?? [];
  const empty = stats && stats.pages === 0;

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-16 pt-8">
      <header className="mb-6 flex items-center justify-between">
        <a href={chrome.runtime.getURL('/search.html')} aria-label="Recall home">
          <Logo />
        </a>
        <button className="btn-ghost" onClick={() => openExtensionPage('/options.html')}>
          <GearIcon /> Settings
        </button>
      </header>

      <p className="muted mb-2 text-xs font-semibold uppercase tracking-wider">Search your browsing memory</p>
      <SearchInput autoFocus={!initial.q} value={query} onChange={setQuery} onSubmit={submit} busy={busy} />
      <div className="mt-3">
        <SearchFilters value={filters} onChange={setFilters} />
      </div>

      <main className="mt-6" aria-live="polite" aria-busy={busy}>
        {response && (
          <div className="muted mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span>
              {results.length} result{results.length === 1 ? '' : 's'} · {response.tookMs} ms
              {!browseMode && !response.semanticAvailable && ' · keyword search only (model not ready)'}
            </span>
            {response.interpretedDate && !ignoreDatePhrase && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                Visited {response.interpretedDate}
                <button aria-label="Ignore date" onClick={() => setIgnoreDatePhrase(true)}>
                  <XIcon className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}

        {response?.error && <p className="card p-4 text-sm text-red-600">Search failed: {response.error}</p>}

        {response && results.length === 0 && !response.error && (
          <div className="card p-8 text-center">
            <p className="font-medium">We couldn't find that page yet.</p>
            <p className="muted mx-auto mt-1 max-w-md text-sm">
              It may not have been indexed. Try describing it differently, remove filters, or search your Chrome history.
            </p>
            {submitted && (
              <button
                className="btn-secondary mt-4"
                onClick={() => chrome.tabs.create({ url: `chrome://history/?q=${encodeURIComponent(submitted)}` })}
              >
                Search Chrome history
              </button>
            )}
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) => (
            <SearchResult key={r.page.page_id} result={r} browseMode={browseMode} onToggleSave={onToggleSave} onDelete={onDelete} />
          ))}
        </div>

        {!response && (
          <div className="space-y-6">
            {recent.length > 0 && (
              <section>
                <h2 className="muted mb-2 text-xs font-semibold uppercase tracking-wider">Recent searches</h2>
                <div className="flex flex-wrap gap-2">
                  {recent.map((s) => (
                    <button
                      key={s.id}
                      className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
                      onClick={() => {
                        setQuery(s.query);
                        submit(s.query);
                      }}
                    >
                      {s.query}
                    </button>
                  ))}
                  <button className="btn-ghost text-xs" onClick={() => db.searches.clear()}>
                    Clear
                  </button>
                </div>
              </section>
            )}
            {empty ? (
              <div className="card p-6 text-sm">
                <p className="font-medium">Nothing remembered yet.</p>
                <p className="muted mt-1">
                  Browse normally — Recall indexes pages as you visit them. You can also import your recent Chrome
                  history from Settings.
                </p>
              </div>
            ) : (
              <div className="card p-6 text-sm">
                <p className="font-medium">Describe what you remember, not where you saw it.</p>
                <ul className="muted mt-2 list-disc space-y-1 pl-5">
                  <li>that AI tutor website I visited in Zimbabwe</li>
                  <li>article explaining how vector databases work</li>
                  <li>tutorial about deploying a Next.js app with PM2 last week</li>
                  <li>construction project management software site:example.com</li>
                </ul>
              </div>
            )}
            <IndexingStatus />
          </div>
        )}
      </main>
    </div>
  );
}

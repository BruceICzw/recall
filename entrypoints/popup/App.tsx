import { useState } from 'react';
import { Logo } from '../../components/Logo';
import { GearIcon, StarIcon, ClockIcon } from '../../components/Icons';
import { IndexingStatus } from '../../components/IndexingStatus';
import { SearchInput } from '../../components/SearchInput';
import { openExtensionPage, useIndexStats, useRecentSearches, useSettings } from '../../hooks/useRecall';

function openSearch(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  openExtensionPage(`/search.html${qs ? `?${qs}` : ''}`);
  window.close();
}

export default function App() {
  const [q, setQ] = useState('');
  const recent = useRecentSearches(5);
  const [settings] = useSettings();
  const stats = useIndexStats(settings.embeddingModel);

  return (
    <main className="w-[380px] space-y-4 p-4">
      <header className="flex items-center justify-between">
        <Logo size={26} />
        <button className="btn-ghost px-2" aria-label="Settings" onClick={() => openExtensionPage('/options.html')}>
          <GearIcon />
        </button>
      </header>

      <SearchInput size="md" autoFocus value={q} onChange={setQ} onSubmit={(v) => v.trim() && openSearch({ q: v.trim() })} />

      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">
            Recent searches
          </h2>
          <ul className="space-y-0.5">
            {recent.map((s) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
                  onClick={() => openSearch({ q: s.query })}
                >
                  <ClockIcon className="shrink-0 text-stone-400" />
                  <span className="truncate">{s.query}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
        onClick={() => openSearch({ saved: '1' })}
      >
        <span className="flex items-center gap-2">
          <StarIcon className="text-amber-500" /> Saved pages
        </span>
        <span className="muted text-xs">{stats?.saved ?? 0}</span>
      </button>

      <IndexingStatus compact />

      <p className="muted text-center text-[11px]">
        Tip: type <kbd className="rounded border border-stone-300 px-1 dark:border-stone-700">rc</kbd> + space in the address bar
      </p>
    </main>
  );
}

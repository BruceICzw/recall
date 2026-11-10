import { useLiveQuery } from 'dexie-react-hooks';
import type { SearchFilters as Filters } from '../types';
import { db } from '../database/schema';
import { DAY, startOfDay } from '../utils/time';

export type DatePreset = 'any' | 'today' | '7d' | '30d' | '90d' | 'custom';

export interface FilterState {
  date: DatePreset;
  from?: string; // yyyy-mm-dd for custom
  to?: string;
  domain: string;
  contentOnly: boolean;
  savedOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = { date: 'any', domain: '', contentOnly: false, savedOnly: false };

export function toSearchFilters(f: FilterState, now = Date.now()): Filters {
  const out: Filters = {};
  switch (f.date) {
    case 'today':
      out.from = startOfDay(now);
      break;
    case '7d':
      out.from = now - 7 * DAY;
      break;
    case '30d':
      out.from = now - 30 * DAY;
      break;
    case '90d':
      out.from = now - 90 * DAY;
      break;
    case 'custom':
      if (f.from) out.from = new Date(`${f.from}T00:00:00`).getTime();
      if (f.to) out.to = new Date(`${f.to}T23:59:59`).getTime();
      break;
  }
  if (f.domain.trim()) out.domain = f.domain.trim().toLowerCase().replace(/^www\./, '');
  if (f.contentOnly) out.contentOnly = true;
  if (f.savedOnly) out.savedOnly = true;
  return out;
}

export function SearchFilters({ value, onChange }: { value: FilterState; onChange: (f: FilterState) => void }) {
  // Top domains for the domain picker.
  const domains = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.pages.orderBy('last_visited_at').reverse().limit(3000).each((p) => {
      counts.set(p.domain, (counts.get(p.domain) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([d]) => d);
  }, []);

  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-accent-600 bg-accent-600 text-white'
        : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Search filters">
      <label className="sr-only" htmlFor="date-filter">
        Date range
      </label>
      <select
        id="date-filter"
        value={value.date}
        onChange={(e) => set({ date: e.target.value as DatePreset })}
        className="input w-auto py-1 text-xs"
      >
        <option value="any">Any time</option>
        <option value="today">Today</option>
        <option value="7d">Past 7 days</option>
        <option value="30d">Past 30 days</option>
        <option value="90d">Past 90 days</option>
        <option value="custom">Custom range…</option>
      </select>
      {value.date === 'custom' && (
        <>
          <input
            type="date"
            aria-label="From date"
            className="input w-auto py-1 text-xs"
            value={value.from ?? ''}
            onChange={(e) => set({ from: e.target.value })}
          />
          <span className="muted text-xs">to</span>
          <input
            type="date"
            aria-label="To date"
            className="input w-auto py-1 text-xs"
            value={value.to ?? ''}
            onChange={(e) => set({ to: e.target.value })}
          />
        </>
      )}
      <input
        list="recall-domains"
        aria-label="Filter by website"
        placeholder="Any website"
        className="input w-44 py-1 text-xs"
        value={value.domain}
        onChange={(e) => set({ domain: e.target.value })}
      />
      <datalist id="recall-domains">
        {domains?.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <button className={chip(value.contentOnly)} aria-pressed={value.contentOnly} onClick={() => set({ contentOnly: !value.contentOnly })}>
        Content indexed
      </button>
      <button className={chip(value.savedOnly)} aria-pressed={value.savedOnly} onClick={() => set({ savedOnly: !value.savedOnly })}>
        ★ Saved
      </button>
      {(value.date !== 'any' || value.domain || value.contentOnly || value.savedOnly) && (
        <button className="btn-ghost py-1 text-xs" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear filters
        </button>
      )}
    </div>
  );
}

import type { SearchResult as Result } from '../types';
import { highlightSegments } from '../modules/search/snippet';
import { formatRelative } from '../utils/time';
import { ExternalIcon, StarIcon, TrashIcon } from './Icons';

const RELEVANCE_STYLE = {
  high: 'bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-200',
  medium: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
  low: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
} as const;
const RELEVANCE_LABEL = { high: 'High match', medium: 'Good match', low: 'Possible match' } as const;

function visitedLabel(ts: number): string {
  const rel = formatRelative(ts);
  return /^(Today|Yesterday|Last week)$/.test(rel) ? rel.toLowerCase() : /ago$/.test(rel) ? rel : `on ${rel}`;
}

function faviconUrl(pageUrl: string): string {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}

interface Props {
  result: Result;
  browseMode?: boolean;
  onToggleSave: (pageId: string) => void;
  onDelete: (pageId: string) => void;
}

export function SearchResult({ result, browseMode, onToggleSave, onDelete }: Props) {
  const { page, snippet, highlights, relevance, saved } = result;
  const title = page.title || page.url;
  return (
    <article className="card group p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <img src={faviconUrl(page.url)} alt="" width={20} height={20} className="mt-0.5 shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="line-clamp-2 text-base font-semibold leading-snug text-stone-900 hover:text-accent-700 hover:underline dark:text-stone-50 dark:hover:text-accent-200"
            >
              {title}
            </a>
            {!browseMode && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RELEVANCE_STYLE[relevance]}`}
                title={`score ${result.score.toFixed(2)} · semantic ${result.semantic.toFixed(2)} · keyword ${result.keyword.toFixed(2)} · recency ${result.recency.toFixed(2)}`}
              >
                {RELEVANCE_LABEL[relevance]}
              </span>
            )}
          </div>
          <p className="muted mt-0.5 truncate text-xs">
            <span className="font-medium text-stone-600 dark:text-stone-300">{page.domain}</span>
            {' · '}Visited {visitedLabel(page.last_visited_at)}
            {page.visit_count > 1 && ` · ${page.visit_count} visits`}
            {!page.has_content && ' · title only'}
          </p>
          <p className="muted mt-0.5 truncate text-[11px] opacity-80">{page.url}</p>
          {snippet && (
            <p className="mt-2 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              {highlightSegments(snippet, highlights).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1 pl-8">
        <a href={page.url} target="_blank" rel="noreferrer" className="btn-secondary">
          <ExternalIcon /> Open original page
        </a>
        <button
          className={`btn-ghost ${saved ? 'text-amber-600 dark:text-amber-400' : ''}`}
          onClick={() => onToggleSave(page.page_id)}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved pages' : 'Save page'}
        >
          <StarIcon filled={saved} /> {saved ? 'Saved' : 'Save'}
        </button>
        <button
          className="btn-ghost ml-auto opacity-60 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
          onClick={() => onDelete(page.page_id)}
          aria-label="Delete from Recall"
          title="Delete from Recall (Chrome history is not affected)"
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  );
}

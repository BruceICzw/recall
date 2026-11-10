/** Natural-language query interpretation. Pure (takes `now` for testability). */
import { DAY, startOfDay } from '../../utils/time';
import { queryTokens } from '../text/tokenize';

export interface ParsedQuery {
  /** Original text. */
  raw: string;
  /** Text sent to the embedding model (date/site phrases removed, filler kept for context). */
  semanticText: string;
  /** Keyword terms (stopwords + memory-filler removed, stemmed). */
  terms: string[];
  from?: number;
  to?: number;
  dateLabel?: string;
  domain?: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

interface DateMatch {
  re: RegExp;
  range: (now: number, m: RegExpMatchArray) => { from: number; to: number; label: string } | null;
}

function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return d.getTime() - day * DAY;
}

function startOfMonth(ts: number, offset = 0): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

const DATE_PATTERNS: DateMatch[] = [
  { re: /\b(earlier )?today\b/i, range: (n) => ({ from: startOfDay(n), to: n, label: 'today' }) },
  {
    re: /\byesterday\b/i,
    range: (n) => ({ from: startOfDay(n) - DAY, to: startOfDay(n), label: 'yesterday' }),
  },
  {
    re: /\b(this|earlier this) week\b/i,
    range: (n) => ({ from: startOfWeek(n), to: n, label: 'this week' }),
  },
  {
    re: /\blast week\b/i,
    // Generous window: people say "last week" for anything 4–14 days ago.
    range: (n) => ({ from: startOfWeek(n) - 7 * DAY, to: startOfWeek(n), label: 'last week' }),
  },
  {
    re: /\b(in the )?(past|last) (few|couple of|\d+) days\b/i,
    range: (n, m) => {
      const k = /\d+/.test(m[3]) ? parseInt(m[3], 10) : m[3] === 'few' ? 5 : 3;
      return { from: startOfDay(n) - k * DAY, to: n, label: `past ${k} days` };
    },
  },
  {
    re: /\b(a )?(few|couple of) days ago\b/i,
    range: (n) => ({ from: startOfDay(n) - 6 * DAY, to: startOfDay(n), label: 'a few days ago' }),
  },
  { re: /\b(past|last) (7 days|seven days)\b/i, range: (n) => ({ from: n - 7 * DAY, to: n, label: 'past 7 days' }) },
  { re: /\bthis month\b/i, range: (n) => ({ from: startOfMonth(n), to: n, label: 'this month' }) },
  {
    re: /\blast month\b/i,
    range: (n) => ({ from: startOfMonth(n, -1), to: startOfMonth(n), label: 'last month' }),
  },
  {
    re: /\b(past|last) (30 days|month or so)\b/i,
    range: (n) => ({ from: n - 30 * DAY, to: n, label: 'past 30 days' }),
  },
  {
    re: /\bthis year\b/i,
    range: (n) => ({ from: new Date(new Date(n).getFullYear(), 0, 1).getTime(), to: n, label: 'this year' }),
  },
  {
    re: /\blast year\b/i,
    range: (n) => {
      const y = new Date(n).getFullYear() - 1;
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: `${y}` };
    },
  },
  {
    re: new RegExp(`\\b(?:in|during|back in) (${MONTHS.join('|')})(?: (\\d{4}))?\\b`, 'i'),
    range: (n, m) => {
      const month = MONTHS.indexOf(m[1].toLowerCase());
      const now = new Date(n);
      let year = m[2] ? parseInt(m[2], 10) : now.getFullYear();
      if (!m[2] && month > now.getMonth()) year -= 1; // "in December" said in March means last December
      const from = new Date(year, month, 1).getTime();
      const to = new Date(year, month + 1, 1).getTime();
      return { from, to, label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${year}` };
    },
  },
  {
    re: /\b(?:in|during) (20\d\d)\b/i,
    range: (_n, m) => {
      const y = parseInt(m[1], 10);
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: `${y}` };
    },
  },
];

const SITE_RE = /\bsite:([a-z0-9.-]+\.[a-z]{2,})\b/i;
const LEADING_COMMAND =
  /^\s*(please\s+)?(find|show( me)?|get|search( for)?|look( for| up)?|where('s| is| was)|what('s| is| was)|which( was)?|i('m| am) looking for|help me find)\b[\s,:]*/i;

export function parseQuery(raw: string, now = Date.now()): ParsedQuery {
  let text = raw.trim();
  const result: ParsedQuery = { raw, semanticText: '', terms: [] };

  const site = text.match(SITE_RE);
  if (site) {
    result.domain = site[1].toLowerCase().replace(/^www\./, '');
    text = text.replace(SITE_RE, ' ');
  }

  for (const p of DATE_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const r = p.range(now, m);
    if (!r) continue;
    result.from = r.from;
    result.to = r.to;
    result.dateLabel = r.label;
    text = text.replace(p.re, ' ');
    break;
  }

  // Remove trailing "I visited/saw/read" fragments left behind by a date phrase.
  text = text.replace(/\b(that|which)?\s*i\s+(visited|saw|read|found|looked at|opened|was reading)\s*$/i, ' ');
  text = text.replace(LEADING_COMMAND, '');
  text = text.replace(/\s+/g, ' ').trim();

  result.semanticText = text || raw.trim();
  result.terms = queryTokens(text);
  return result;
}

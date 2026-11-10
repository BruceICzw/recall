/** URL helpers. Pure functions — safe to use in any extension context and in tests. */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  '_hsenc',
  '_hsmi',
  'igshid',
  'si',
]);

/** Only http(s) pages are eligible for Recall. */
export function isIndexableUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalise a URL so repeat visits map to one page record:
 * lowercase host, drop `www.`, fragment, tracking params, default ports and trailing slash.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    let out = u.toString();
    if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '');
    // http and https versions of the same page are the same page for recall purposes.
    return out.replace(/^http:\/\//, 'https://');
  } catch {
    return url;
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** FNV-1a 64-bit-ish (two 32-bit lanes) hash, returned as hex. Deterministic and fast. */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Stable page id for a URL. */
export function pageIdFor(url: string): string {
  return hashString(normalizeUrl(url));
}

/** True if `domain` equals `rule` or is a subdomain of it. */
export function domainMatches(domain: string, rule: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const r = rule
    .toLowerCase()
    .trim()
    .replace(/^\*\./, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  if (!r) return false;
  return d === r || d.endsWith('.' + r);
}

/** Clean a user-entered domain ("https://www.Example.com/path" → "example.com"). */
export function cleanDomainInput(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  try {
    const withProto = /^[a-z]+:\/\//.test(s) ? s : `https://${s}`;
    return new URL(withProto).hostname.replace(/^www\./, '').replace(/^\*\./, '');
  } catch {
    return s.replace(/^\*\./, '').replace(/\/.*$/, '');
  }
}

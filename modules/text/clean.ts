/** Text normalisation for extracted page content. Pure. */

const BOILERPLATE_LINE =
  /^(accept( all)? cookies|we use cookies|cookie (settings|policy)|skip to (main )?content|share (this|on)|subscribe( now)?|sign up for our newsletter|advertisement|all rights reserved|©.*|privacy policy|terms of (use|service)|log ?in|sign ?in|menu|search|close|back to top|read more|loading\.\.\.)$/i;

/** Max characters of content stored per page (~ 30–40 pages of text). */
export const MAX_CONTENT_CHARS = 60_000;

/**
 * Normalise whitespace, drop boilerplate/duplicate lines and cap length.
 * Paragraph breaks are preserved as "\n\n" so the chunker can respect them.
 */
export function cleanText(raw: string, maxChars = MAX_CONTENT_CHARS): string {
  if (!raw) return '';
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[  -​  　]/g, ' ')
    .replace(/­/g, '') // soft hyphen
    .replace(/[\t ]+/g, ' ');

  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const block of text.split(/\n\s*\n+/)) {
    const lines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (BOILERPLATE_LINE.test(line)) continue;
      // Drop exact duplicate lines longer than a few words (repeated nav, footers, captions).
      const key = line.toLowerCase();
      if (line.length > 20 && seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    if (lines.length) paragraphs.push(lines.join(' '));
  }

  let out = paragraphs.join('\n\n').trim();
  if (out.length > maxChars) {
    const cut = out.lastIndexOf(' ', maxChars);
    out = out.slice(0, cut > maxChars * 0.8 ? cut : maxChars);
  }
  return out;
}

/** Single-line version for titles/descriptions. */
export function cleanInline(raw: string | null | undefined, maxChars = 500): string {
  if (!raw) return '';
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > maxChars ? s.slice(0, maxChars).trimEnd() + '…' : s;
}

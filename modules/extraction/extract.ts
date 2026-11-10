/**
 * Readable-content extraction (FR-02). Runs inside the page via the injected capture script.
 * Uses Mozilla Readability with a DOM-text fallback. Never reads form values, cookies or storage.
 */
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { CapturePayload } from '../../types';

const MAX_RAW_CHARS = 200_000;

function meta(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLMetaElement>(sel);
    const v = el?.content?.trim();
    if (v) return v;
  }
  return '';
}

function canonicalUrl(doc: Document): string | undefined {
  const href = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (!href) return undefined;
  try {
    const c = new URL(href, doc.baseURI);
    // Only trust same-site canonicals – cross-site canonicals are often wrong/misleading.
    if (c.hostname.replace(/^www\./, '') !== location.hostname.replace(/^www\./, '')) return undefined;
    return c.toString();
  } catch {
    return undefined;
  }
}

function publishedAt(doc: Document): number | undefined {
  const raw =
    meta(doc, [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="date"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]',
      'meta[name="DC.date.issued"]',
    ]) || doc.querySelector('time[datetime]')?.getAttribute('datetime') || '';
  const ts = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ts) && ts > 0 && ts < Date.now() + 86_400_000 ? ts : undefined;
}

/** Text fallback for pages Readability rejects (apps, dashboards, docs sites). */
function fallbackText(doc: Document): string {
  const root = (doc.querySelector('main, [role="main"], article') as HTMLElement | null) ?? doc.body;
  if (!root) return '';
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      'script, style, noscript, template, svg, canvas, iframe, nav, header, footer, aside, form, input, textarea, select, button, [aria-hidden="true"], [hidden], [role="navigation"], [role="banner"], [role="contentinfo"], .cookie, #cookie-banner',
    )
    .forEach((el) => el.remove());
  return blockText(clone);
}

/** textContent with paragraph breaks after block elements (innerText needs layout; detached nodes have none). */
function blockText(root: HTMLElement): string {
  root.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
  root.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, pre, blockquote, figcaption, dd, dt').forEach((el) => {
    el.append('\n\n');
  });
  root.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  return (root.textContent ?? '').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n');
}

export function hasSensitiveInputs(doc: Document): boolean {
  return !!doc.querySelector(
    'input[type="password"], input[autocomplete="cc-number"], input[autocomplete="one-time-code"], input[name*="card" i][name*="number" i]',
  );
}

export function extractPage(doc: Document = document): CapturePayload {
  const url = location.href;
  const base = {
    url,
    canonical_url: canonicalUrl(doc),
    title: doc.title || meta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']),
    description: meta(doc, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]),
    published_at: publishedAt(doc),
  };

  const contentType = doc.contentType || '';
  if (contentType && !/html|xml/i.test(contentType)) {
    return { ...base, content: '', status: 'unsupported', reason: contentType };
  }

  // Login / payment / 2FA pages: keep metadata, never content.
  if (hasSensitiveInputs(doc)) {
    return { ...base, content: '', status: 'blocked', reason: 'sensitive_inputs' };
  }

  try {
    let text = '';
    if (isProbablyReaderable(doc, { minContentLength: 140, minScore: 20 })) {
      const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse();
      if (article?.textContent && article.textContent.trim().length > 200) {
        // Rebuild text from the article HTML so paragraph breaks survive (textContent flattens them).
        text = article.content ? blockText(new DOMParser().parseFromString(article.content, 'text/html').body) : '';
        if (text.trim().length < 200) text = article.textContent;
        if (!base.title && article.title) base.title = article.title;
        if (!base.description && article.excerpt) base.description = article.excerpt;
      }
    }
    if (!text) text = fallbackText(doc);
    text = text.slice(0, MAX_RAW_CHARS);
    if (text.trim().length < 40) {
      return { ...base, content: '', status: 'failed', reason: 'no_readable_content' };
    }
    return { ...base, content: text, status: 'extracted' };
  } catch (err) {
    return { ...base, content: '', status: 'failed', reason: String((err as Error)?.message ?? err) };
  }
}

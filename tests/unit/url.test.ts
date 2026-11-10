import { describe, expect, it } from 'vitest';
import { cleanDomainInput, domainMatches, getDomain, isIndexableUrl, normalizeUrl, pageIdFor } from '../../utils/url';

describe('normalizeUrl', () => {
  it('collapses www, fragments, tracking params, trailing slash and scheme', () => {
    const a = normalizeUrl('https://www.Example.com/docs/intro/?utm_source=x&b=2&a=1#section');
    const b = normalizeUrl('http://example.com/docs/intro?a=1&b=2');
    expect(a).toBe('https://example.com/docs/intro?a=1&b=2');
    expect(a).toBe(b);
  });
  it('keeps meaningful query params', () => {
    expect(normalizeUrl('https://youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc');
  });
  it('maps repeat visits to one page id', () => {
    expect(pageIdFor('https://a.com/x#y')).toBe(pageIdFor('https://www.a.com/x/'));
    expect(pageIdFor('https://a.com/x')).not.toBe(pageIdFor('https://a.com/y'));
  });
});

describe('url helpers', () => {
  it('only http(s) is indexable', () => {
    expect(isIndexableUrl('https://a.com')).toBe(true);
    expect(isIndexableUrl('chrome://settings')).toBe(false);
    expect(isIndexableUrl('chrome-extension://abc/search.html')).toBe(false);
    expect(isIndexableUrl('file:///etc/passwd')).toBe(false);
    expect(isIndexableUrl(undefined)).toBe(false);
  });
  it('matches subdomains', () => {
    expect(domainMatches('docs.github.com', 'github.com')).toBe(true);
    expect(domainMatches('github.com', 'github.com')).toBe(true);
    expect(domainMatches('notgithub.com', 'github.com')).toBe(false);
    expect(domainMatches('www.bank.co.zw', '*.bank.co.zw')).toBe(true);
  });
  it('cleans user input', () => {
    expect(cleanDomainInput(' https://www.Example.com/path ')).toBe('example.com');
    expect(cleanDomainInput('*.foo.org')).toBe('foo.org');
    expect(getDomain('https://www.news.bbc.co.uk/a')).toBe('news.bbc.co.uk');
  });
});

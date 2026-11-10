import { describe, expect, it } from 'vitest';
import { checkCaptureEligibility, isExcluded, isMetadataEligible, isSensitiveUrl } from '../../modules/privacy/exclusions';

const base = { paused: false, skipSensitive: true, excludedDomains: [] as string[] };

describe('sensitive URL detection', () => {
  it.each([
    'https://mail.google.com/mail/u/0/#inbox',
    'https://accounts.google.com/signin',
    'https://www.paypal.com/myaccount',
    'https://login.example.com/',
    'https://www.stanbicbank.co.zw/personal',
    'https://ib.cbzbank.co.zw/',
    'https://shop.example.com/checkout/step-1',
    'https://github.com/settings/tokens',
    'https://example.com/reset-password?token=x',
  ])('flags %s', (url) => {
    expect(isSensitiveUrl(url)).toBe(true);
  });
  it.each([
    'https://github.com/vercel/next.js',
    'https://en.wikipedia.org/wiki/Vector_database',
    'https://pm2.keymetrics.io/docs/usage/quick-start/',
    'https://www.herald.co.zw/ai-tutor-launched/',
    'https://news.ycombinator.com/item?id=1',
  ])('allows %s', (url) => {
    expect(isSensitiveUrl(url)).toBe(false);
  });
});

describe('capture eligibility', () => {
  it('never captures incognito', () => {
    expect(checkCaptureEligibility({ ...base, url: 'https://a.com', incognito: true })).toEqual({ eligible: false, reason: 'incognito' });
  });
  it('respects exclusions (including subdomains)', () => {
    const r = checkCaptureEligibility({ ...base, url: 'https://docs.secret.org/x', excludedDomains: ['secret.org'] });
    expect(r).toEqual({ eligible: false, reason: 'excluded' });
    expect(isExcluded('https://secret.org', ['secret.org'])).toBe(true);
    expect(isMetadataEligible('https://docs.secret.org', ['secret.org'])).toBe(false);
  });
  it('respects pause', () => {
    expect(checkCaptureEligibility({ ...base, url: 'https://a.com', paused: true })).toEqual({ eligible: false, reason: 'paused' });
  });
  it('skips non-web and sensitive pages unless disabled', () => {
    expect(checkCaptureEligibility({ ...base, url: 'chrome://history' }).eligible).toBe(false);
    expect(checkCaptureEligibility({ ...base, url: 'https://mail.google.com' })).toEqual({ eligible: false, reason: 'sensitive' });
    expect(checkCaptureEligibility({ ...base, skipSensitive: false, url: 'https://mail.google.com' }).eligible).toBe(true);
  });
  it('allows normal pages', () => {
    expect(checkCaptureEligibility({ ...base, url: 'https://example.com/article' })).toEqual({ eligible: true });
  });
});

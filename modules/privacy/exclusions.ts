/** Capture-eligibility rules. Pure — the background worker supplies settings + user exclusions. */
import { domainMatches, getDomain, isIndexableUrl } from '../../utils/url';

/** Exact domains skipped by default when "Skip sensitive sites" is on. Users can't see/need to manage these. */
export const SENSITIVE_DOMAINS = [
  // email & identity
  'mail.google.com',
  'accounts.google.com',
  'myaccount.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'login.microsoftonline.com',
  'login.live.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'appleid.apple.com',
  'icloud.com',
  // payments & finance
  'paypal.com',
  'dashboard.stripe.com',
  'checkout.stripe.com',
  'wise.com',
  'revolut.com',
  'ecocash.co.zw',
  'onemoney.co.zw',
  'paynow.co.zw',
  'mpesa.co.ke',
  // password managers
  '1password.com',
  'bitwarden.com',
  'lastpass.com',
  // health portals
  'mychart.org',
  // Recall's own pages and browser internals are never indexed anyway.
];

/** Hostname labels that indicate an auth / account / mail surface (login.example.com, secure.bank.com …). */
const SENSITIVE_LABELS = new Set([
  'login',
  'signin',
  'auth',
  'sso',
  'secure',
  'accounts',
  'account',
  'webmail',
  'mail',
  'myaccount',
  'banking',
  'ebanking',
  'netbanking',
  'onlinebanking',
  'ibanking',
  'checkout',
  'pay',
  'payments',
  'billing',
  'wallet',
  'patient',
  'portal',
  'vault',
  'admin',
]);

/** URL path segments that indicate a sensitive flow. */
const SENSITIVE_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|auth|oauth2?|sso|password|reset-password|forgot|checkout|payment|billing|account|settings|2fa|mfa|verify|inbox)(\/|$|\?|\.)/i;

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: 'not_web' | 'excluded' | 'sensitive' | 'paused' | 'incognito' };

export interface EligibilityInput {
  url: string;
  incognito?: boolean;
  paused: boolean;
  skipSensitive: boolean;
  excludedDomains: string[];
}

export function isSensitiveUrl(url: string): boolean {
  const domain = getDomain(url);
  if (!domain) return false;
  if (SENSITIVE_DOMAINS.some((d) => domainMatches(domain, d))) return true;
  const labels = domain.split('.');
  // Ignore the registrable part (last two labels) so "pay.com"-style brands aren't over-blocked by SENSITIVE_LABELS,
  // but do flag subdomains such as login.example.com.
  const subLabels = labels.slice(0, Math.max(0, labels.length - 2));
  if (subLabels.some((l) => SENSITIVE_LABELS.has(l))) return true;
  // Any domain with "bank" in its registrable name (e.g. stanbicbank.co.zw, chase-bank.com, mybank.co.uk).
  const registrable = labels.slice(-3).join('.');
  if (/bank/.test(registrable)) return true;
  try {
    const { pathname } = new URL(url);
    if (SENSITIVE_PATH.test(pathname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isExcluded(url: string, excludedDomains: string[]): boolean {
  const domain = getDomain(url);
  return excludedDomains.some((rule) => domainMatches(domain, rule));
}

/** Should Recall capture *content* for this URL? (Metadata from history is governed only by exclusions.) */
export function checkCaptureEligibility(input: EligibilityInput): Eligibility {
  if (input.incognito) return { eligible: false, reason: 'incognito' };
  if (!isIndexableUrl(input.url)) return { eligible: false, reason: 'not_web' };
  if (isExcluded(input.url, input.excludedDomains)) return { eligible: false, reason: 'excluded' };
  if (input.paused) return { eligible: false, reason: 'paused' };
  if (input.skipSensitive && isSensitiveUrl(input.url)) return { eligible: false, reason: 'sensitive' };
  return { eligible: true };
}

/** Should Recall keep a *metadata* record for this URL? */
export function isMetadataEligible(url: string, excludedDomains: string[]): boolean {
  return isIndexableUrl(url) && !isExcluded(url, excludedDomains);
}

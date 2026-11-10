/**
 * Public URLs. Set them in a `.env` file at the project root (see `.env.example`), then rebuild:
 *   WXT_SITE_URL=https://your-site.netlify.app
 *   WXT_REPO_URL=https://github.com/you/recall
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const SITE_URL = (env.WXT_SITE_URL ?? '').replace(/\/$/, '');
export const REPO_URL = (env.WXT_REPO_URL ?? '').replace(/\/$/, '');
export const PRIVACY_URL = SITE_URL ? `${SITE_URL}/privacy` : '';

/**
 * Capture script. Not declared in the manifest — the background worker injects it with
 * chrome.scripting.executeScript only into eligible tabs (not excluded, not sensitive,
 * not paused, not Incognito, host access granted). Reads the DOM once and exits.
 */
import { extractPage } from '../modules/extraction/extract';

export default defineUnlistedScript(() => {
  const w = window as unknown as { __recallCapturedUrl?: string };
  if (w.__recallCapturedUrl === location.href) return;
  w.__recallCapturedUrl = location.href;
  try {
    const payload = extractPage(document);
    chrome.runtime.sendMessage({ target: 'background', type: 'capture', payload }).catch(() => {});
  } catch {
    /* never break the host page */
  }
});

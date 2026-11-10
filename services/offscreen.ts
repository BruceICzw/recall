/** Offscreen document lifecycle (background context only). */

const OFFSCREEN_PATH = 'offscreen.html';
let creating: Promise<void> | null = null;

export async function hasOffscreenDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    });
    return contexts.length > 0;
  }
  return false;
}

/** Create the offscreen document that hosts the embedding model, if it doesn't exist. */
export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (creating) return creating;
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the local embedding model that indexes and searches your browsing history on-device.',
    })
    .catch((err: Error) => {
      // A concurrent create from another event can race us; that's fine.
      if (!/single offscreen|already exists/i.test(String(err?.message))) throw err;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

export async function closeOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
}

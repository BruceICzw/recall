import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { db } from '../database/schema';
import { getSettings, updateSettings } from '../database/settings';
import { getIndexStats, type IndexStats } from '../database/pages';
import { send, sendWithTimeout, type ModelStatus } from '../services/messaging';

export const HOST_ORIGINS = ['http://*/*', 'https://*/*'];

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>, boolean] {
  const loaded = useLiveQuery(getSettings, []);
  const settings = loaded ?? DEFAULT_SETTINGS;
  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const previousModel = settings.embeddingModel;
      await updateSettings(patch);
      await send({ target: 'background', type: 'settings-changed', previousModel }).catch(() => {});
    },
    [settings.embeddingModel],
  );
  return [settings, update, loaded !== undefined];
}

export function useIndexStats(modelId: string): IndexStats | undefined {
  return useLiveQuery(() => getIndexStats(modelId), [modelId]);
}

export function useExcludedDomains(): string[] {
  return useLiveQuery(async () => (await db.excluded_domains.orderBy('domain').toArray()).map((d) => d.domain), [], []);
}

export function useRecentSearches(limit = 6) {
  return useLiveQuery(() => db.searches.orderBy('searched_at').reverse().limit(limit).toArray(), [limit], []);
}

/** Whether Recall may read page content (optional host permission). */
export function useHostAccess(): { granted: boolean | undefined; request: () => Promise<boolean>; revoke: () => Promise<void> } {
  const [granted, setGranted] = useState<boolean>();
  const refresh = useCallback(() => {
    chrome.permissions.contains({ origins: HOST_ORIGINS }).then(setGranted);
  }, []);
  useEffect(() => {
    refresh();
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);
    return () => {
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);
  const request = useCallback(async () => {
    // Must be called directly from a user gesture.
    const ok = await chrome.permissions.request({ origins: HOST_ORIGINS });
    setGranted(ok);
    if (ok) send({ target: 'background', type: 'host-access-changed' }).catch(() => {});
    return ok;
  }, []);
  const revoke = useCallback(async () => {
    await chrome.permissions.remove({ origins: HOST_ORIGINS });
    refresh();
  }, [refresh]);
  return { granted, request, revoke };
}

/** Polls the offscreen indexer for model state. `undefined` = indexer not running. */
export function useModelStatus(intervalMs = 2000): ModelStatus | undefined {
  const [status, setStatus] = useState<ModelStatus>();
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await sendWithTimeout<ModelStatus>({ target: 'offscreen', type: 'model-status' }, 1500);
      if (alive) setStatus(s && 'state' in s ? s : undefined);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return status;
}

export function useStorageEstimate(): { usage: number; quota: number } | undefined {
  const [est, setEst] = useState<{ usage: number; quota: number }>();
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, []);
  return est;
}

export function openExtensionPage(path: string): void {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

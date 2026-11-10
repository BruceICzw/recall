/**
 * Background service worker (MV3). Registers browser events, decides capture eligibility,
 * persists captures and pokes the offscreen indexer. Holds no essential in-memory state —
 * everything survives suspension because it lives in IndexedDB.
 */
import type { Message, ModelStatus } from '../services/messaging';
import { ensureOffscreen, hasOffscreenDocument, closeOffscreen } from '../services/offscreen';
import { db } from '../database/schema';
import { enqueueMany, hasPendingJobs, resetStaleJobs } from '../database/chunks';
import { recordVisit } from '../database/pages';
import { getExcludedDomains, getSettings } from '../database/settings';
import { handleHistoryRemoved, importHistory } from '../modules/history/import';
import { ensureMetaChunk, ingestCapture, PRIORITY_CAPTURED, PRIORITY_REINDEX } from '../modules/indexing/pipeline';
import { checkCaptureEligibility, isMetadataEligible } from '../modules/privacy/exclusions';
import { isIndexableUrl, pageIdFor } from '../utils/url';
import { MINUTE } from '../utils/time';

const HEARTBEAT = 'recall-heartbeat';
const CAPTURE_DELAY_MS = 1500; // let SPAs / lazy content settle
const RECAPTURE_AFTER_MS = 30 * MINUTE;

export default defineBackground(() => {
  // --- lifecycle ---------------------------------------------------------
  chrome.runtime.onInstalled.addListener(async (details) => {
    await chrome.alarms.create(HEARTBEAT, { periodInMinutes: 1 });
    // Nothing is recorded until the user accepts the disclosure on the welcome page.
    if (details.reason === 'install' || !(await getSettings()).consentedAt) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    }
    await resetStaleJobs(0);
    kickQueue();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await chrome.alarms.create(HEARTBEAT, { periodInMinutes: 1 });
    await resetStaleJobs(0);
    kickQueue();
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== HEARTBEAT) return;
    if (await hasPendingJobs()) kickQueue(0);
    else await maybeCloseIdleOffscreen();
  });

  // --- history (FR-01) ---------------------------------------------------
  chrome.history.onVisited.addListener(async (item) => {
    if (!item.url) return;
    const settings = await getSettings();
    if (!settings.consentedAt) return;
    const excluded = await getExcludedDomains();
    if (!isMetadataEligible(item.url, excluded)) return;
    const { page, created } = await recordVisit({
      url: item.url,
      title: item.title,
      visitedAt: item.lastVisitTime ?? Date.now(),
      source: 'history',
    });
    if (created) await ensureMetaChunk(page, settings.embeddingModel);
    kickQueue();
  });

  chrome.history.onVisitRemoved.addListener((removed) => {
    handleHistoryRemoved(removed).catch((err) => console.warn('[Recall] history reconcile failed', err));
  });

  // --- content capture (FR-02) ------------------------------------------
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const recent = new Map<string, number>(); // page_id → last capture ts (best-effort; lost on suspend)

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete' && !info.url) return;
    if (!isIndexableUrl(tab.url) || tab.incognito) return;
    clearTimeout(timers.get(tabId));
    timers.set(
      tabId,
      setTimeout(() => {
        timers.delete(tabId);
        captureTab(tabId).catch((err) => console.debug('[Recall] capture skipped', err?.message ?? err));
      }, CAPTURE_DELAY_MS),
    );
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearTimeout(timers.get(tabId));
    timers.delete(tabId);
  });

  async function captureTab(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.status !== 'complete') return;
    const settings = await getSettings();
    if (!settings.consentedAt) return;
    const excluded = await getExcludedDomains();
    const eligibility = checkCaptureEligibility({
      url: tab.url,
      incognito: tab.incognito,
      paused: settings.indexingPaused,
      skipSensitive: settings.skipSensitiveSites,
      excludedDomains: excluded,
    });
    if (!eligibility.eligible) return;

    const pageId = pageIdFor(tab.url);
    const last = recent.get(pageId);
    if (last && Date.now() - last < RECAPTURE_AFTER_MS) return;
    recent.set(pageId, Date.now());
    if (recent.size > 500) recent.delete(recent.keys().next().value!);

    if (settings.captureMode === 'metadata') {
      // No script injection at all in metadata-only mode.
      await ingestCapture({ url: tab.url, title: tab.title ?? '', description: '', content: '', status: 'extracted' }, settings);
      kickQueue();
      return;
    }

    const origin = new URL(tab.url).origin + '/*';
    if (!(await chrome.permissions.contains({ origins: [origin] }))) return; // host access not granted
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['/capture.js'] });
  }

  // --- messages ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || msg?.target !== 'background') return false;
    handleMessage(msg, sender).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  });

  async function handleMessage(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
      case 'capture': {
        if (sender.tab?.incognito) return { ok: false, error: 'incognito' };
        const url = msg.payload.url;
        const settings = await getSettings();
        if (!settings.consentedAt) return { ok: false, error: 'no_consent' };
        const excluded = await getExcludedDomains();
        const e = checkCaptureEligibility({
          url,
          incognito: sender.tab?.incognito,
          paused: settings.indexingPaused,
          skipSensitive: settings.skipSensitiveSites,
          excludedDomains: excluded,
        });
        if (!e.eligible) return { ok: false, error: e.reason };
        const res = await ingestCapture(msg.payload, settings);
        if (res.changed) kickQueue();
        return { ok: true, ...res };
      }
      case 'ensure-offscreen':
        await ensureOffscreen();
        return { ok: true };
      case 'import-history': {
        if (!(await getSettings()).consentedAt) return { ok: false, error: 'no_consent' };
        const r = await importHistory();
        kickQueue();
        return { ok: true, ...r };
      }
      case 'settings-changed': {
        const settings = await getSettings();
        if (msg.previousModel && msg.previousModel !== settings.embeddingModel) {
          await reindexAll(settings.embeddingModel);
        }
        if (!settings.indexingPaused) kickQueue(0);
        return { ok: true };
      }
      case 'host-access-changed':
        return { ok: true };
      case 'open-search':
        await openSearch(msg.query, msg.saved);
        return { ok: true };
      default:
        return { ok: false, error: 'unknown message' };
    }
  }

  // --- omnibox: type "rc <what you remember>" in the address bar ----------
  chrome.omnibox.setDefaultSuggestion({ description: 'Search your browsing memory with Recall' });
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = chrome.runtime.getURL(`/search.html?q=${encodeURIComponent(text)}`);
    if (disposition === 'currentTab') chrome.tabs.update({ url });
    else chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
  });

  // --- helpers -----------------------------------------------------------
  let kickTimer: ReturnType<typeof setTimeout> | undefined;
  function kickQueue(delay = 2000): void {
    clearTimeout(kickTimer);
    kickTimer = setTimeout(async () => {
      try {
        const settings = await getSettings();
        if (settings.indexingPaused || !(await hasPendingJobs())) return;
        await ensureOffscreen();
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'process-queue' } satisfies Message);
      } catch (err) {
        console.debug('[Recall] queue kick failed', err);
      }
    }, delay);
  }

  async function reindexAll(modelId: string): Promise<void> {
    const withContent = await db.pages.where('has_content').equals(1).primaryKeys();
    const metaOnly = await db.pages.where('has_content').equals(0).primaryKeys();
    await enqueueMany(withContent, PRIORITY_CAPTURED + 1, modelId);
    await enqueueMany(metaOnly, PRIORITY_REINDEX, modelId);
  }

  async function openSearch(query?: string, saved?: boolean): Promise<void> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (saved) params.set('saved', '1');
    await chrome.tabs.create({ url: chrome.runtime.getURL(`/search.html?${params}`) });
  }

  /** Free the model's memory (~100 MB) after 10 idle minutes; it reloads on demand. */
  async function maybeCloseIdleOffscreen(): Promise<void> {
    if (!(await hasOffscreenDocument())) return;
    const status = await chrome.runtime
      .sendMessage({ target: 'offscreen', type: 'model-status' } satisfies Message)
      .catch(() => undefined);
    const last = (status as ModelStatus | undefined)?.lastActivity ?? 0;
    if (!(status as ModelStatus | undefined)?.queueRunning && Date.now() - last > 10 * MINUTE) {
      await closeOffscreen();
    }
  }
});

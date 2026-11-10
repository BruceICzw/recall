/**
 * Offscreen document: hosts the embedding model and the indexing queue.
 * MV3 service workers cannot run Transformers.js (no dynamic import, frequent suspension),
 * so inference happens here. Query embeddings for the search page are served from here too,
 * so the model is loaded only once.
 */
import type { EmbedQueryResponse, Message, ModelStatus } from '../../services/messaging';
import { TransformersEmbeddingProvider } from '../../modules/embeddings/transformers-provider';
import { getModel } from '../../modules/embeddings/models';
import { processQueue } from '../../modules/indexing/queue';
import { getSettings } from '../../database/settings';

let provider: TransformersEmbeddingProvider | null = null;
let queueRunning = false;
let rerun = false;
const status: ModelStatus = {
  modelId: '',
  state: 'idle',
  queueRunning: false,
  lastActivity: Date.now(),
};

async function getProvider(modelId: string): Promise<TransformersEmbeddingProvider> {
  if (provider && provider.model.id === modelId) {
    await provider.load();
    return provider;
  }
  if (provider) await provider.dispose();
  const settings = await getSettings();
  provider = new TransformersEmbeddingProvider(getModel(modelId), { allowRemote: settings.allowModelDownload });
  status.modelId = modelId;
  status.state = 'loading';
  status.error = undefined;
  try {
    await provider.load((p) => {
      if (typeof p.progress === 'number') status.progress = Math.round(p.progress);
    });
    status.state = 'ready';
    status.source = provider.source;
    status.device = provider.device;
    return provider;
  } catch (err) {
    status.state = 'error';
    status.error = String((err as Error)?.message ?? err);
    provider = null;
    throw err;
  }
}

async function runQueue(): Promise<void> {
  if (queueRunning) {
    rerun = true;
    return;
  }
  queueRunning = status.queueRunning = true;
  try {
    do {
      rerun = false;
      const res = await processQueue(getProvider, {
        budgetMs: 10 * 60_000,
        onProgress: () => (status.lastActivity = Date.now()),
      });
      if (res.stoppedReason === 'model_error' || res.stoppedReason === 'paused' || res.stoppedReason === 'storage_full')
        break;
    } while (rerun);
  } finally {
    queueRunning = status.queueRunning = false;
    status.lastActivity = Date.now();
  }
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.target !== 'offscreen') return false;
  switch (msg.type) {
    case 'process-queue':
      void runQueue();
      sendResponse({ ok: true });
      return false;
    case 'model-status':
      sendResponse({ ...status });
      return false;
    case 'embed-query':
      (async (): Promise<EmbedQueryResponse> => {
        status.lastActivity = Date.now();
        const { embeddingModel } = await getSettings();
        const p = await getProvider(embeddingModel);
        const [v] = await p.embed([msg.text], 'query');
        return { ok: true, vector: Array.from(v), modelId: embeddingModel };
      })().then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
  }
  return false;
});

// Start draining any pending work as soon as the document opens (e.g. after a browser restart).
void runQueue();

/**
 * Transformers.js (ONNX Runtime Web) embedding provider.
 * Runs inside the offscreen document — never in the MV3 service worker, which forbids dynamic import().
 */
import type { EmbedKind, EmbeddingProvider, LoadProgress } from './provider';
import type { ModelInfo } from './models';

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

export interface TransformersProviderOptions {
  /** Permit downloading weights from huggingface.co when they are not bundled in /models. */
  allowRemote: boolean;
  /** Max texts per inference call. */
  batchSize?: number;
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  source: 'bundled' | 'downloaded' | 'unknown' = 'unknown';
  device = 'wasm';
  private extractor: Extractor | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    readonly model: ModelInfo,
    private readonly opts: TransformersProviderOptions,
  ) {}

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.extractor) return Promise.resolve();
    this.loading ??= this.doLoad(onProgress).catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  private async doLoad(onProgress?: (p: LoadProgress) => void): Promise<void> {
    const { pipeline, env } = await import('@huggingface/transformers');

    const bundled = await this.isBundled();
    env.allowLocalModels = bundled;
    env.localModelPath = chrome.runtime.getURL('models/');
    env.allowRemoteModels = !bundled && this.opts.allowRemote;
    env.useBrowserCache = true;
    if (!bundled && !this.opts.allowRemote) {
      throw new Error(
        `Model ${this.model.id} is not bundled with the extension and model downloads are disabled in Settings.`,
      );
    }
    this.source = bundled ? 'bundled' : 'downloaded';

    // Serve ONNX Runtime's wasm/mjs from the extension package (copied by scripts/copy-ort.mjs).
    // MV3's CSP forbids loading them from a CDN.
    const onnx = (env.backends as any)?.onnx;
    if (onnx?.wasm) {
      onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');
      onnx.wasm.numThreads = 1; // no cross-origin isolation in extension pages → no SharedArrayBuffer threads
      onnx.wasm.proxy = false;
    }

    this.extractor = (await pipeline('feature-extraction', this.model.id, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: any) =>
        onProgress?.({ status: String(p?.status ?? ''), file: p?.file, progress: p?.progress }),
    } as any)) as unknown as Extractor;
    this.device = 'wasm';
  }

  private async isBundled(): Promise<boolean> {
    try {
      const res = await fetch(chrome.runtime.getURL(`models/${this.model.id}/config.json`));
      return res.ok;
    } catch {
      return false;
    }
  }

  /** ONNX sessions must not run concurrently; serialise inference calls (one batch at a time). */
  private lock: Promise<unknown> = Promise.resolve();
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    await this.load();
    const prefix = kind === 'query' ? this.model.queryPrefix : this.model.passagePrefix;
    const batchSize = this.opts.batchSize ?? 8;
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => prefix + t);
      // Each batch takes the lock separately so a user's query can slip in between indexing batches.
      const res = await this.runExclusive(() => this.extractor!(batch, { pooling: 'mean', normalize: true }));
      const dims = res.dims[res.dims.length - 1];
      for (let j = 0; j < batch.length; j++) out.push(res.data.slice(j * dims, (j + 1) * dims));
    }
    return out;
  }

  async dispose(): Promise<void> {
    const ex = this.extractor as unknown as { dispose?: () => Promise<void> } | null;
    await ex?.dispose?.();
    this.extractor = null;
    this.loading = null;
  }
}

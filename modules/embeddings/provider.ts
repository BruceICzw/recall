/**
 * Embedding provider abstraction (PRD §9.5, §21): the search engine and indexing queue only
 * depend on this interface, so models/runtimes can be swapped without touching them.
 */
import type { ModelInfo } from './models';

export type EmbedKind = 'query' | 'passage';

export interface LoadProgress {
  file?: string;
  /** 0..100 when known */
  progress?: number;
  status: string;
}

export interface EmbeddingProvider {
  readonly model: ModelInfo;
  /** Where the weights came from once loaded. */
  readonly source: 'bundled' | 'downloaded' | 'unknown';
  readonly device: string;
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  /** Returns one L2-normalised vector per input text. */
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

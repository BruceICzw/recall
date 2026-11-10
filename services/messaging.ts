/** Typed runtime messages between Recall's extension contexts. */
import type { CapturePayload } from '../types';

export type Message =
  | { target: 'background'; type: 'capture'; payload: CapturePayload }
  | { target: 'background'; type: 'ensure-offscreen' }
  | { target: 'background'; type: 'import-history' }
  | { target: 'background'; type: 'settings-changed'; previousModel?: string }
  | { target: 'background'; type: 'host-access-changed' }
  | { target: 'background'; type: 'open-search'; query?: string; saved?: boolean }
  | { target: 'offscreen'; type: 'process-queue' }
  | { target: 'offscreen'; type: 'embed-query'; text: string }
  | { target: 'offscreen'; type: 'model-status' };

export interface EmbedQueryResponse {
  ok: boolean;
  vector?: number[];
  modelId?: string;
  error?: string;
}

export interface ModelStatus {
  modelId: string;
  state: 'idle' | 'loading' | 'ready' | 'error';
  source?: string;
  device?: string;
  progress?: number;
  error?: string;
  queueRunning: boolean;
  /** ms timestamp of the last embed/queue activity */
  lastActivity: number;
}

export function send<T = unknown>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

/** sendMessage with a timeout; resolves undefined on timeout or when no receiver exists. */
export async function sendWithTimeout<T>(msg: Message, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      send<T>(msg),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

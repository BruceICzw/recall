/** Embedding model registry (PRD §9.5). Add models here; the rest of the system reads this metadata. */
import type { SimilarityCalibration } from '../search/rank';

export interface ModelInfo {
  id: string;
  label: string;
  dims: number;
  /** Approximate download size of the quantised ONNX weights. */
  sizeMb: number;
  languages: string;
  license: string;
  queryPrefix: string;
  passagePrefix: string;
  /** Cosine range used to normalise similarity to 0..1 for ranking. Calibrate with `npm run eval`. */
  calibration: SimilarityCalibration;
}

export const MODELS: Record<string, ModelInfo> = {
  'Xenova/all-MiniLM-L6-v2': {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'MiniLM-L6 v2 (English, fast)',
    dims: 384,
    sizeMb: 23,
    languages: 'English',
    license: 'Apache-2.0',
    queryPrefix: '',
    passagePrefix: '',
    calibration: { floor: 0.12, ceil: 0.62 },
  },
  'Xenova/multilingual-e5-small': {
    id: 'Xenova/multilingual-e5-small',
    label: 'Multilingual E5 small (100+ languages)',
    dims: 384,
    sizeMb: 118,
    languages: '~100 languages incl. Shona, Ndebele (limited), French, Portuguese, Swahili',
    license: 'MIT',
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    calibration: { floor: 0.74, ceil: 0.9 },
  },
};

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

export function getModel(id: string | undefined): ModelInfo {
  return (id && MODELS[id]) || MODELS[DEFAULT_MODEL_ID];
}

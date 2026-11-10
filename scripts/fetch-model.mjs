#!/usr/bin/env node
/**
 * Bundle an embedding model inside the extension so Recall works fully offline
 * (no download on first use). Files go to public/models/<model-id>/.
 *
 *   npm run fetch-model                         # default: Xenova/all-MiniLM-L6-v2
 *   npm run fetch-model -- Xenova/multilingual-e5-small
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelId = process.argv[2] || 'Xenova/all-MiniLM-L6-v2';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];
const OPTIONAL = new Set(['special_tokens_map.json']);

const base = `https://huggingface.co/${modelId}/resolve/main/`;
const outDir = join(root, 'public', 'models', modelId);

for (const f of FILES) {
  const dst = join(outDir, f);
  if (existsSync(dst)) {
    console.log(`✓ ${f} (already present)`);
    continue;
  }
  process.stdout.write(`↓ ${f} … `);
  const res = await fetch(base + f);
  if (!res.ok) {
    if (OPTIONAL.has(f)) {
      console.log('skipped (optional)');
      continue;
    }
    console.error(`failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`\nModel bundled at public/models/${modelId}. Rebuild the extension (npm run build).`);

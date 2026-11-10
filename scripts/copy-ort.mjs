#!/usr/bin/env node
/**
 * Copies ONNX Runtime Web's wasm + loader files into public/ort/ so they ship inside the
 * extension. MV3's Content Security Policy blocks loading them from a CDN at runtime.
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ort');

function findOrtDist() {
  const req = createRequire(join(root, 'package.json'));
  const candidates = [];
  try {
    // Prefer the copy Transformers.js actually depends on (may be nested).
    const tjs = dirname(req.resolve('@huggingface/transformers/package.json'));
    candidates.push(join(tjs, 'node_modules', 'onnxruntime-web', 'dist'));
  } catch {
    /* not installed yet */
  }
  try {
    candidates.push(join(dirname(req.resolve('onnxruntime-web/package.json')), 'dist'));
  } catch {
    /* hoisted copy may not exist */
  }
  candidates.push(join(root, 'node_modules', 'onnxruntime-web', 'dist'));
  return candidates.find((c) => existsSync(c));
}

const dist = findOrtDist();
if (!dist) {
  console.warn('[copy-ort] onnxruntime-web not found — run `npm install` first. Skipping.');
  process.exit(0);
}

// Transformers.js v3 uses the JSEP build of ONNX Runtime (WebAssembly + WebGPU kernels).
// Ship only that variant: the plain build is another 11 MB nobody loads.
const KEEP = /^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/;

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) {
  if (!KEEP.test(f)) rmSync(join(out, f));
}
let copied = 0;
for (const f of readdirSync(dist)) {
  if (!KEEP.test(f)) continue;
  const src = join(dist, f);
  const dst = join(out, f);
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
  cpSync(src, dst);
  copied++;
}
console.log(`[copy-ort] ${copied} file(s) copied from ${dist} → public/ort`);

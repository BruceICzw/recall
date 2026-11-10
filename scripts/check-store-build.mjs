#!/usr/bin/env node
/**
 * Pre-flight for `npm run zip` (Chrome Web Store build):
 *  - the embedding model must be bundled, so the published extension makes no network requests
 *    and contains no remotely loaded logic;
 *  - WXT_SITE_URL should be set so the privacy-policy link and homepage_url are filled in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(root, 'public', 'models', 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx');
let ok = true;
if (!existsSync(model)) {
  console.error('✗ Embedding model not bundled. Run `npm run fetch-model` first.');
  ok = false;
} else console.log('✓ Embedding model bundled');

const envFile = join(root, '.env');
const env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const site = process.env.WXT_SITE_URL || (env.match(/^WXT_SITE_URL=(.+)$/m) || [])[1];
if (!site || /your-recall-site/.test(site)) {
  console.error('✗ WXT_SITE_URL is not set. Copy .env.example to .env and set your landing-page URL.');
  ok = false;
} else console.log(`✓ Site URL: ${site.trim()}`);

process.exit(ok ? 0 : 1);

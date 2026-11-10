import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';

// Make WXT_* values from .env available here too (Vite only exposes them to app code).
if (existsSync('.env')) {
  for (const m of readFileSync('.env', 'utf8').matchAll(/^\s*(WXT_[A-Z_]+)\s*=\s*(.*?)\s*$/gm)) {
    process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

// See https://wxt.dev/api/config.html
// E2E builds (RECALL_E2E=1) pre-grant host access to the local fixture server, because
// optional-permission prompts can't be clicked in automation.
const E2E = !!process.env.RECALL_E2E;

/**
 * ONNX Runtime's bundle references its wasm via `new URL(..., import.meta.url)`, so Vite emits a
 * second ~22 MB copy into assets/. Recall loads the runtime from /ort (wasmPaths), so drop it.
 */
const dropDuplicateOrtWasm = {
  name: 'recall:drop-duplicate-ort-wasm',
  generateBundle(_opts: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) {
      if (/^assets\/ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file];
    }
  },
};

export default defineConfig({
  outDir: E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss(), dropDuplicateOrtWasm],
    // Transformers.js ships its own wasm loader; keep it out of dependency pre-bundling.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
  }),
  manifest: {
    name: 'Recall',
    ...(process.env.WXT_SITE_URL ? { homepage_url: process.env.WXT_SITE_URL } : {}),
    description:
      "Find anything you've visited online, even when you can't remember where you found it. Local-first, private browsing memory.",
    permissions: [
      'history', // FR-01: import + monitor history metadata
      'unlimitedStorage', // IndexedDB index can grow beyond default quota
      'scripting', // inject the capture script into eligible pages
      'tabs', // tab URL/title/incognito flag for capture eligibility
      'alarms', // resumable maintenance (job queue heartbeat)
      'offscreen', // run the embedding model outside the MV3 service worker
      'favicon', // show site icons in results (served locally by Chrome, no network)
    ],
    // Content capture needs host access. It is requested progressively during
    // onboarding (or in Settings) instead of at install time.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // *.example is used by the store-screenshot script's fictional demo sites.
    ...(E2E ? { host_permissions: ['http://127.0.0.1/*', 'https://*.example/*'] } : {}),
    content_security_policy: {
      // 'wasm-unsafe-eval' is required for the ONNX Runtime WebAssembly backend.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    omnibox: { keyword: 'rc' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Open Recall',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    // Recall never runs in Incognito.
    incognito: 'not_allowed',
  },
});

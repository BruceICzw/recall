# Recall

**Find anything you've visited online, even when you can't remember where you found it.**

Recall is a local-first Chrome extension (Manifest V3) that indexes the pages you visit and lets you search them in natural language: *"that AI tutor website I visited in Zimbabwe"*, *"the tutorial about deploying Next.js with PM2 last week"*. Everything (page text, embeddings, search) stays on your device.

This is the MVP described in the PRD (v1.0). Stack: WXT · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Transformers.js · Mozilla Readability · Vitest · Playwright.

---

## Install (early access)

Recall isn't in the Chrome Web Store yet. Until it is, install it from a GitHub release:

1. Download `recall-<version>-chrome.zip` from the [latest release](https://github.com/BruceICzw/recall/releases/latest) and unzip it to a folder you'll keep. Chrome loads the extension from that folder, so don't delete it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
4. The welcome page opens. Read what Recall collects and click **Agree and start**.

To update, download the new release, unzip it over the same folder, and click the reload icon on Recall's card in `chrome://extensions`. Your data is kept.

Chrome may show a banner about developer-mode extensions. That's normal for anything not installed from the store.

## Quick start (Windows, macOS, Linux)

Requires Node.js 20+ and Google Chrome 116+.

```bash
npm install            # also runs `wxt prepare` and copies ONNX Runtime wasm into public/ort
npm run fetch-model    # optional but recommended: bundles the 23 MB model so Recall works fully offline
npm run build          # → .output/chrome-mv3
```

Load it in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `.output/chrome-mv3`.
3. The welcome page opens. Click **Enable content indexing** to let Recall read the pages you visit.

For development with hot reload: `npm run dev` (WXT opens a Chrome instance with the extension loaded).

**Using it:** click the toolbar icon, press **Alt+Shift+R**, or type **`rc` + space** in the address bar followed by what you remember.

If you skip `fetch-model`, the model downloads once from huggingface.co on first use and is cached. Only the model files are fetched; none of your data is sent. You can turn downloads off under Settings → Embedding model.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev build with hot reload |
| `npm run build` / `npm run zip` | Production build / Chrome Web Store zip |
| `npm run fetch-model [-- <model-id>]` | Bundle an embedding model in `public/models/` |
| `npm test` | Unit and integration tests (Vitest, fake-indexeddb, a fake embedder) |
| `npm run eval` | Search-quality evaluation: P@5, R@10, MRR, Hit@5 and latency (keyword baseline) |
| `RECALL_EVAL_MODEL=1 npm run eval` | The same evaluation with the real MiniLM model (PowerShell: `$env:RECALL_EVAL_MODEL="1"; npm run eval`) |
| `npm run test:e2e` | Builds an E2E variant and runs Playwright in Chromium with the extension loaded (run `npx playwright install chromium` once first) |
| `npm run compile` | Type-check |
| `npm run store:screenshots` | Generate the five 1280×800 store screenshots from the real UI |

---

## How it works

```
 tab loads ─► background SW ─► eligibility check (Incognito / excluded / sensitive / paused / host access)
                 │                     │ ok
                 │                     ▼
                 │            inject capture.js (Readability) ─► page text ─┐
 history.onVisited ─► page + visit record (metadata)                       │
                 ▼                                                         ▼
           IndexedDB  ◄──── clean → chunk → indexing_jobs ◄──── ingestCapture()
                 │
                 ▼
        offscreen document  ── Transformers.js (MiniLM, ONNX wasm) ──► embeddings
                 ▲
 search page ────┘ query embedding     +  in-memory BM25 + vector cache
                    → hybrid rank: 0.65·semantic + 0.25·keyword + 0.10·recency
```

- **Background service worker** (`entrypoints/background.ts`): registers events and holds no essential in-memory state, so suspension is harmless. A one-minute alarm restarts interrupted work.
- **Capture script** (`entrypoints/capture.ts`): not in the manifest. It is injected only into eligible tabs, runs Readability once and exits. It never reads form values, cookies or storage. Pages with password or card fields keep metadata only.
- **Offscreen document** (`entrypoints/offscreen/`): MV3 service workers can't run Transformers.js, so the model lives here and serves both indexing and query embeddings. It closes after 10 idle minutes to free memory.
- **Indexing queue** (`modules/indexing/queue.ts`): every job is stored in IndexedDB, so a crash or restart just resumes. A failing page is retried 3 times. If the model is unavailable, no attempts are used up.
- **Search engine** (`modules/search/engine.ts`) works in five steps:
  1. Interpret the query: date phrases ("last week", "in March"), `site:` and filler words.
  2. Retrieve the top-k chunks by cosine similarity.
  3. Score keywords with BM25F, with typo and prefix tolerance.
  4. Group by page so long pages don't dominate.
  5. Rank, deduplicate by canonical URL, and build snippets.

  If the model is unavailable, search falls back to keywords only.
- **Embedding provider** (`modules/embeddings/`): sits behind an interface. To add a model, add it to `models.ts` and give it a similarity calibration. Switching models re-indexes everything in the background.

### Data model (IndexedDB `recall`)

`pages`, `visits`, `chunks`, `embeddings`, `saved_pages`, `searches`, `settings`, `excluded_domains`, `indexing_jobs`. Schema changes go in `database/migrations.ts` as a new version.

### Privacy

- No backend, accounts, analytics or third-party AI calls.
- Recall is disabled in Incognito (`incognito: not_allowed`).
- Sensitive sites are skipped by default: banking, payments (including EcoCash, OneMoney and Paynow), email, login/SSO, checkout and account pages, and any page with a password or card field.
- Host access is requested progressively. You can grant it during onboarding or in Settings, and revoke it at any time.
- Deleting a page removes its chunks, embeddings, visits, saved state and jobs. "Clear all" keeps only settings and exclusions.
- Recall never deletes Chrome history. When you delete Chrome history, Recall follows by default; saved pages are kept.
- You can export all your data as JSON, with page text and embeddings optional.

### Known limitations (MVP)

- Chrome's History API has no page contents. Imported history is searchable by title and URL until you revisit a page.
- PDFs and Chrome's built-in viewer pages are stored as metadata only.
- The first search after opening the search page builds the in-memory index. This takes a few seconds on very large indexes; later searches are fast.
- Vectors are brute-force scanned. That's fine up to around 100k chunks. Beyond that, add an ANN index or quantise vectors.
- The ONNX Runtime wasm files make the package roughly 30–60 MB. If you need a smaller zip, trim `public/ort` to the variants you use.

---

## Publishing

Everything for the Chrome Web Store is in [`store/LISTING.md`](store/LISTING.md): listing copy, privacy-tab answers, permission justifications, reviewer notes and a policy self-check. The landing page and privacy policy live in the separate **recall-site** repo and deploy to Netlify or Vercel.

> **If you change what Recall collects, stores or sends, update `src/privacy.html` in recall-site too.** The Chrome Web Store requires the policy to match the extension's behaviour, and they're in different repos.

Recall shows a disclosure on its welcome page and records nothing until the user clicks **Agree and start**. The store requires this consent step for extensions that collect browsing activity.

## Project structure

```
entrypoints/   background.ts · capture.ts · offscreen/ · popup/ · search/ · options/ · welcome/
components/    SearchInput · SearchResult · SearchFilters · IndexingStatus · Toggle · Logo · Icons
modules/       history · extraction · text · indexing · embeddings · search · privacy
database/      schema · migrations · pages · chunks · settings
services/      messaging · offscreen
hooks/ utils/ types/ assets/ public/ scripts/ tests/{unit,eval,e2e}
store/         LISTING.md · images/ · screenshots/ · promo-src/
```

## Testing status

The pure modules (URL normalisation, cleaning, chunking, tokenising, query parsing, BM25, ranking, snippets, privacy rules, metrics) have 62 passing unit tests. The keyword-only baseline on the starter eval set scores Hit@5 0.90, MRR 0.88 and P@5 0.83. The Dexie integration tests (`tests/unit/pipeline.test.ts`), the real-model eval and the Playwright E2E suite are included, but they need `npm install` to run. Run `npm test` and `npm run test:e2e` after your first install.

Grow `tests/eval/dataset.json` to the PRD's 100–200 pages and 50+ queries using real pages you've visited, then calibrate the ranking weights in `modules/search/rank.ts` and the `calibration` values in `modules/embeddings/models.ts`.

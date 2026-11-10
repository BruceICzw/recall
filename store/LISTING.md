# Chrome Web Store submission kit — Recall 1.0.0

Copy and paste each field into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Fields are in dashboard order. Replace the `<SITE>` and `<REPO>` placeholders with your Netlify/Vercel URL and GitHub URL.

**Before you upload:**

1. `npm run fetch-model` bundles the model, so the published build makes no network requests.
2. `cp .env.example .env`, then set `WXT_SITE_URL` and `WXT_REPO_URL`.
3. Deploy the **recall-site** repo (see its README) and check that `<SITE>/privacy` loads.
4. `npm run zip` creates `.output/recall-1.0.0-chrome.zip`. The zip refuses to build if the model or the site URL is missing.
5. `npm run store:screenshots` creates `store/screenshots/*.png`.
6. Turn on 2-Step Verification on your Google account. The store requires it before you can publish.

---

## 1. Package

Upload `.output/recall-1.0.0-chrome.zip`.

## 2. Store listing

**Name** (from manifest): `Recall`

**Summary** (from manifest description, 123/132 characters):

> Find anything you've visited online, even when you can't remember where you found it. Local-first, private browsing memory.

**Category:** Productivity → Tools. Workflow & Planning also fits.

**Language:** English

**Description:**

```
Recall lets you search your browsing history by describing what you remember, not by remembering the website.

"That AI tutor website I visited in Zimbabwe"
"The article explaining how vector databases work"
"Tutorial about deploying Next.js with PM2 last week"

Chrome's history only matches page titles and addresses. Recall understands what pages were about, so you can find them with incomplete, fuzzy memories.

HOW IT WORKS
• As you browse, Recall saves the readable text of pages you visit to a private index on your computer.
• A small AI model (MiniLM) runs inside the extension, on your device, to understand meaning — not just keywords.
• Search combines meaning, keywords (with typo tolerance) and recency, and shows you the matching passage.
• Understands dates in your search: "yesterday", "last week", "in March". Filter by date, website or saved pages.

PRIVATE BY DESIGN
• Everything is stored and processed on your device. Recall has no servers, accounts, analytics or ads.
• Your browsing data is never sent anywhere, sold, or used for anything except your own search.
• Never runs in Incognito. Skips banking, payment, email and login pages, and never reads passwords or form inputs.
• You choose: full page text, or titles and addresses only. Exclude any website. Pause anytime.
• Delete a single page, a whole site, or everything. Export your data as JSON.
• Deleting in Recall never touches your Chrome history.
• Open source: verify every claim in the code.

GETTING STARTED
1. Install Recall and read the one-page explanation of what it collects. Nothing is recorded until you agree.
2. Optionally allow Recall to read the pages you visit (for full-text search).
3. Browse normally. Then click the Recall icon, press Alt+Shift+R, or type "rc" + space in the address bar.

Pages from your existing Chrome history are imported by title and address. Chrome doesn't store page contents, so older pages become fully searchable when you revisit them.

Source code: <REPO>
Privacy policy: <SITE>/privacy
```

**Graphic assets** (all in `store/images/` and `store/screenshots/`):

| Field | File | Spec |
|---|---|---|
| Store icon | `store/images/store-icon-128.png` | 128×128, 96×96 artwork, 16 px transparent padding |
| Screenshots (1–5) | `store/screenshots/1-…png` to `5-…png` | 1280×800, full bleed |
| Small promo tile | `store/images/small-promo-tile-440x280.png` | 440×280 |
| Marquee (optional; needed to be featured) | `store/images/marquee-1400x560.png` | 1400×560 |

Re-render the promo images by opening `store/promo-src/*.html` in Chrome, or with Playwright.

**Official URL:** `<SITE>`. Verify it in Google Search Console if you want the "verified" badge.
**Homepage URL:** `<SITE>`
**Support URL:** `<REPO>/issues`
**Mature content:** No

## 3. Privacy practices

### Single purpose

```
Recall lets users search the web pages they have previously visited using natural-language descriptions. It indexes the user's browsing history and the readable text of visited pages on the user's device and provides a search interface over that local index.
```

### Permission justifications

| Permission | Justification (paste) |
|---|---|
| `history` | Recall's core feature is searching pages the user has visited. It reads Chrome history metadata (URL, title, visit time) to import recent history, record new visits, and remove pages from its local index when the user deletes them from Chrome history. |
| `unlimitedStorage` | The search index (page text, text chunks and embedding vectors) is stored locally in IndexedDB and can exceed the default quota for users with large histories. Nothing is stored remotely. |
| `scripting` | Used to inject a one-time capture script into eligible tabs to extract the page's readable text (Mozilla Readability). It is only injected after checking consent, user exclusions, the pause setting, Incognito and sensitive-site rules. It never modifies pages. |
| `tabs` | Reads the URL, title, loading status and Incognito flag of tabs to decide whether a page may be indexed. Also used to open Recall's search, settings and onboarding pages. |
| `alarms` | A one-minute alarm resumes interrupted background indexing after the service worker is suspended or the browser restarts. |
| `offscreen` | The on-device embedding model (Transformers.js / ONNX Runtime WebAssembly) cannot run in an MV3 service worker, so it runs in an offscreen document. |
| `favicon` | Shows site icons next to search results, using Chrome's local favicon cache. No network requests. |
| Host permissions (optional: `http://*/*`, `https://*/*`) | Requested at runtime only if the user chooses to enable full-text search during onboarding or in Settings. They let Recall read the text of pages the user visits so those pages can be found by their content. Users can decline (titles and addresses only) or revoke this at any time. |

### Remote code

**"No, I am not using remote code."**

All JavaScript and WebAssembly (ONNX Runtime) ships in the package. The embedding model weights are bundled in `models/` and loaded from the extension package. No code or logic is fetched at runtime.

> If you publish a build *without* running `npm run fetch-model`, the extension would download model weights from huggingface.co on first use. These are data, not code, but bundling avoids any ambiguity. `npm run zip` enforces it.

### Data usage

**Tick the data your extension collects:**

- [x] **Web history**: list of pages visited, titles and visit times.
- [x] **Website content**: readable text of visited pages, only if the user enables it.
- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Authentication information
- [ ] Personal communications
- [ ] Location
- [ ] User activity

The store's guidance is that data processed only on the device still counts as handled and must be disclosed. That's why these two are ticked even though nothing leaves the device.

**Certify all three:**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `<SITE>/privacy`

## 4. Distribution

- **Visibility:** Public. Consider Unlisted first if you want a soft launch with a direct link.
- **Regions:** All
- **Pricing:** Free

## 5. Notes for the reviewer (paste into "Additional information" if asked)

```
Recall is a local-only search tool for the user's own browsing history.

How to test:
1. Install. The welcome page opens and explains exactly what is collected. Nothing is recorded until "Agree and start" is clicked (prominent disclosure + affirmative consent, per the User Data policy).
2. Optionally click "Enable page content" to grant the optional host permission.
3. Visit a few article pages (e.g. Wikipedia), then click the toolbar icon and describe one of them in plain words.
4. Settings shows all stored data counts, exclusions, pause, export, delete, and "Turn off Recall" (withdraws consent and deletes all data).

Data handling: all data stays in the extension's IndexedDB on the device. There is no backend and no network traffic from the extension (the AI model is bundled). Incognito is not supported (manifest incognito: not_allowed). Pages with password/card fields and banking, payment, email and login sites are never read.

Source code: <REPO>
```

## Policy self-check

| Requirement | How Recall meets it |
|---|---|
| Prominent disclosure and affirmative consent inside the product UI, before collecting browsing activity | The welcome page states what is collected, where it goes and how it's used, with an "Agree and start" button. The background worker records nothing until `consentedAt` is set (`entrypoints/background.ts`). The E2E test checks this. |
| Collecting browsing activity only for a user-facing feature | Collected data is used only for the search UI. |
| Narrowest permissions | `storage` was removed as unused. Host access is optional and requested at runtime. |
| Limited Use statement on a public site you own | recall-site `src/privacy.html`, "Limited Use" section |
| Privacy policy accurate and matching the dashboard | recall-site `src/privacy.html` lists the same two data types and the same zero-transmission claim |
| No remote code | WASM and model bundled. `npm run zip` checks. |
| No obfuscation | Vite minification only (allowed). Source is public. |
| Withdrawing consent | Settings → Turn off Recall |

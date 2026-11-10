#!/usr/bin/env node
/**
 * Generates Chrome Web Store screenshots (1280×800 PNG) from the real extension UI.
 *
 *   npm run store:screenshots      → store/screenshots/*.png
 *
 * Loads the E2E build in Chromium, consents, "visits" fictional demo sites on the reserved
 * .example TLD (served by Playwright, nothing leaves your machine), waits for indexing, then
 * captures the search, popup, welcome and settings pages.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(root, '.output-e2e', 'chrome-mv3');
const OUT = join(root, 'store', 'screenshots');
mkdirSync(OUT, { recursive: true });

const HOSTS = {
  learnzim: 'learnzim',
  edresearch: 'edresearch',
  blog: 'vectorguide',
  docs: 'dbdocs',
  devnotes: 'devnotes',
  buildtrack: 'buildtrack',
  rentflow: 'rentflow',
  fintechreview: 'fintechreview',
  kitchen: 'kitchen',
  mobiledev: 'mobiledev',
  github: 'speechlab',
  mlguide: 'mlguide',
  perf: 'sqlperf',
  energy: 'solarguide',
  cloudbasics: 'cloudbasics',
  news: 'sportsdaily',
};
const dataset = JSON.parse(readFileSync(join(root, 'tests', 'eval', 'dataset.json'), 'utf8'));
const pages = dataset.pages.map((p) => {
  const u = new URL(p.url);
  const label = u.hostname.split('.')[0];
  return { ...p, url: `https://${HOSTS[label] ?? label}.example${u.pathname}` };
});
const html = (p) => `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title>
  <meta name="description" content="${p.content.slice(0, 150).replace(/"/g, '&quot;')}"></head>
  <body><nav>Home · Blog · About</nav><main><article><h1>${p.title}</h1>
  ${p.content.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => `<p>${s}</p>`).join('\n')}
  </article></main><footer>© Demo site</footer></body></html>`;

const profile = mkdtempSync(join(tmpdir(), 'recall-shots-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1, // the store requires exactly 1280×800
  colorScheme: process.env.DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route('https://*.example/**', (route) => {
  const url = new URL(route.request().url());
  const page = pages.find((p) => {
    const pu = new URL(p.url);
    return pu.hostname === url.hostname && pu.pathname === url.pathname;
  });
  if (!page) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: 'text/html', body: html(page) });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const ext = (path) => `chrome-extension://${extId}/${path}`;

// 1. Consent on the welcome page.
const welcome = ctx.pages().find((p) => p.url().includes('welcome.html')) ?? (await ctx.newPage());
if (!welcome.url().includes('welcome.html')) await welcome.goto(ext('welcome.html'));
await welcome.getByRole('button', { name: 'Agree and start' }).click();
await welcome.getByText('Recall is on').waitFor();

// 2. Browse the demo sites.
for (const p of pages) {
  const tab = await ctx.newPage();
  await tab.goto(p.url);
  await tab.waitForTimeout(2200);
  await tab.close();
  process.stdout.write('.');
}
console.log(' visited', pages.length, 'demo pages');

// 3. Wait for the indexing queue to drain.
const status = await ctx.newPage();
await status.goto(ext('options.html'));
await status.getByText('Queued for indexing').waitFor();
for (let i = 0; i < 60; i++) {
  const queued = await status.locator('text=Queued for indexing').locator('..').locator('div').first().textContent();
  if (queued?.trim() === '0') break;
  await status.waitForTimeout(1000);
}
await status.close();

async function shot(name, page) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log('✓', name);
}

async function searchShot(name, q) {
  const page = await ctx.newPage();
  await page.goto(`${ext('search.html')}?q=${encodeURIComponent(q)}`);
  await page.waitForSelector('text=/\\d+ results?/', { timeout: 60_000 });
  await page.waitForSelector('article');
  await shot(name, page);
  await page.close();
}

await searchShot('1-search-ai-tutor.png', 'that AI tutor website I visited in Zimbabwe');
await searchShot('2-search-vector-db.png', 'article explaining how vector databases find similar items');

// Popup, framed on a 1280×800 canvas with a caption.
{
  const page = await ctx.newPage();
  await page.goto(ext('popup.html'));
  await page.waitForSelector('main');
  await page.evaluate(() => {
    const main = document.querySelector('main');
    document.body.style.cssText =
      'margin:0;height:800px;display:flex;align-items:center;justify-content:center;gap:72px;background:linear-gradient(135deg,#eefbf8,#e7eef9)';
    main.style.cssText += ';background:white;border-radius:16px;box-shadow:0 24px 60px rgba(16,62,55,.18)';
    const cap = document.createElement('div');
    cap.innerHTML =
      '<div style="font:600 40px/1.15 system-ui;color:#103e37;max-width:440px">Describe it.<br>Recall finds it.</div>' +
      '<p style="font:400 19px/1.5 system-ui;color:#3c4a47;max-width:420px;margin-top:16px">One click from any tab. Or type <b>rc</b> + space in the address bar.</p>';
    document.body.prepend(cap);
  });
  await shot('3-popup.png', page);
  await page.close();
}

{
  const page = await ctx.newPage();
  await page.goto(ext('welcome.html'));
  await page.waitForSelector('text=What Recall collects');
  await shot('4-privacy-consent.png', page);
  await page.close();
}

{
  const page = await ctx.newPage();
  await page.goto(ext('options.html'));
  await page.getByRole('heading', { name: 'Privacy' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Privacy');
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 24);
  });
  await shot('5-settings-privacy.png', page);
  await page.close();
}

await ctx.close();
console.log(`\nScreenshots written to ${OUT}`);

/**
 * End-to-end tests in a real Chromium with the built extension loaded.
 *
 *   npx playwright install chromium   # once
 *   npm run test:e2e                  # builds .output-e2e (host access for 127.0.0.1) and runs
 *
 * Without network access the model can't download, so these tests assert on behaviour that
 * works in keyword-fallback mode too. With network (or a bundled model) semantic search runs.
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve('.output-e2e/chrome-mv3');
const PAGES: Record<string, string> = {
  '/ai-tutor.html': `<html><head><title>LearnZim — smart learning</title><meta name="description" content="Personal AI tutor for students"></head>
    <body><nav>Home · About</nav><article><h1>Your personal AI tutor</h1>
    ${'<p>LearnZim gives secondary school students in Zimbabwe a personal AI tutor that explains maths and science step by step, aligned with the ZIMSEC syllabus. Teachers in Harare and Bulawayo track progress on dashboards.</p>'.repeat(4)}
    </article></body></html>`,
  '/login.html': `<html><head><title>Sign in</title></head><body><form><p>Quokkasecretword account portal</p>
    <input name="u"><input type="password" name="p"></form></body></html>`,
  '/before.html': `<html><head><title>Visited before consent</title></head><body><article>
    ${'<p>Wombatprecheck is a word that only appears on a page visited before the user agreed to anything.</p>'.repeat(4)}
    </article></body></html>`,
  '/pizza.html': `<html><head><title>Neapolitan pizza at home</title></head><body><article>
    ${'<p>Ferment the dough for 48 hours, stretch it by hand, add San Marzano tomatoes and mozzarella, and bake on a hot steel.</p>'.repeat(4)}
    </article></body></html>`,
};

let server: Server;
let base = '';
const profile = mkdtempSync(join(tmpdir(), 'recall-e2e-'));

async function launch(): Promise<{ ctx: BrowserContext; extId: string }> {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // new headless mode supports extensions
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  return { ctx, extId: new URL(sw.url()).host };
}

async function search(ctx: BrowserContext, extId: string, q: string) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/search.html?q=${encodeURIComponent(q)}`);
  await page.waitForSelector('text=/\\d+ results?/', { timeout: 45_000 });
  return page;
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server.close());

test('captures, searches, survives restart, deletes', async () => {
  let { ctx, extId } = await launch();

  // Onboarding (disclosure + consent) opens on install.
  await expect.poll(() => ctx.pages().some((p) => p.url().includes('welcome.html'))).toBe(true);
  const welcome = ctx.pages().find((p) => p.url().includes('welcome.html'))!;

  // Nothing is captured before consent.
  const pre = await ctx.newPage();
  await pre.goto(base + '/before.html');
  await pre.waitForTimeout(3500);
  await pre.close();

  // Prominent disclosure → affirmative consent.
  await expect(welcome.getByText('What Recall collects')).toBeVisible();
  await welcome.getByRole('button', { name: 'Agree and start' }).click();
  await expect(welcome.getByText('Recall is on')).toBeVisible();

  for (const path of ['/ai-tutor.html', '/pizza.html', '/login.html']) {
    const p = await ctx.newPage();
    await p.goto(base + path);
    await p.waitForTimeout(3500); // capture delay + ingest
    await p.close();
  }

  // Natural-language search finds the captured page with a snippet.
  let page = await search(ctx, extId, 'that AI tutor website I visited in Zimbabwe');
  const first = page.locator('article').first();
  await expect(first).toContainText('LearnZim');
  await expect(first).toContainText('ZIMSEC');
  // The bundled model loaded: results are hybrid, not the keyword fallback.
  await expect(page.getByText('keyword search only')).toHaveCount(0);

  // The pre-consent page's content was never read (its title may arrive later via history import).
  page = await search(ctx, extId, 'wombatprecheck');
  await expect(page.locator('article', { hasText: /wombatprecheck/i })).toHaveCount(0);

  // Sensitive page (password field): its body text must never be stored or shown.
  // (Its title "Sign in" may still appear from history metadata — that's by design.)
  page = await search(ctx, extId, 'quokkasecretword');
  await expect(page.locator('article', { hasText: /quokkasecretword/i })).toHaveCount(0);

  // Persistence across a browser restart.
  await ctx.close();
  ({ ctx, extId } = await launch());
  page = await search(ctx, extId, 'homemade pizza dough');
  await expect(page.locator('article').first()).toContainText('Neapolitan pizza');

  // Deleting removes it from results (and from the index).
  await page.locator('article').first().getByRole('button', { name: 'Delete from Recall' }).click();
  await expect(page.locator('article', { hasText: 'Neapolitan pizza' })).toHaveCount(0);
  page = await search(ctx, extId, 'homemade pizza dough');
  await expect(page.locator('article', { hasText: 'Neapolitan pizza' })).toHaveCount(0);

  await ctx.close();
});

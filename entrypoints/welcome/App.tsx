import { useState } from 'react';
import { Logo } from '../../components/Logo';
import { ShieldIcon } from '../../components/Icons';
import { openExtensionPage, useHostAccess, useIndexStats, useSettings } from '../../hooks/useRecall';
import { send } from '../../services/messaging';
import { PRIVACY_URL } from '../../utils/links';

/**
 * Onboarding + prominent disclosure and consent (Chrome Web Store User Data policy).
 * Recall records nothing until the user clicks "Agree and start".
 */
export default function App() {
  const [settings, update] = useSettings();
  const stats = useIndexStats(settings.embeddingModel);
  const host = useHostAccess();
  const [starting, setStarting] = useState(false);
  const consented = !!settings.consentedAt;

  const agree = async () => {
    setStarting(true);
    await update({ consentedAt: Date.now(), onboarded: true });
    await send({ target: 'background', type: 'import-history' }).catch(() => {});
    setStarting(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Logo size={36} />
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Find anything you've visited online.</h1>
      <p className="muted mt-2 text-lg">Even when you can't remember where you found it.</p>

      <ol className="mt-8 space-y-4">
        <li className="card p-5" aria-labelledby="disclosure-h">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">
            Step 1 {consented ? '· done' : ''}
          </p>
          <h2 id="disclosure-h" className="mt-1 flex items-center gap-2 font-medium">
            <ShieldIcon className="shrink-0 text-accent-600" /> What Recall collects, and where it goes
          </h2>
          <div className="mt-2 space-y-2 text-sm leading-relaxed">
            <p>To let you search your browsing by description, Recall collects:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Your web browsing history:</strong> the addresses, titles and visit times of pages you visit,
                including the last {settings.historyImportDays} days from Chrome's history.
              </li>
              <li>
                <strong>The readable text of pages you visit</strong>, but only if you allow it in step 2.
              </li>
            </ul>
            <p>
              This data is <strong>stored and processed only on this computer</strong>, and it is used only to power your
              search. It is never sent to us or anyone else, never sold, and never used for ads. Recall has no servers,
              accounts or analytics.
            </p>
            <p className="muted text-xs">
              Recall never runs in Incognito. It skips banking, payment, email and login pages, and never reads passwords,
              form inputs or cookies. You can pause it, exclude sites, delete anything, or remove all data in Settings.{' '}
              {PRIVACY_URL && (
                <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">
                  Read the privacy policy
                </a>
              )}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {consented ? (
              <span className="text-sm font-medium text-accent-700 dark:text-accent-400">
                ✓ Recall is on.{' '}
                {stats ? `${stats.pages.toLocaleString()} pages imported from your history (titles and addresses).` : ''}
              </span>
            ) : (
              <>
                <button className="btn-primary" onClick={agree} disabled={starting}>
                  {starting ? 'Starting…' : 'Agree and start'}
                </button>
                <button className="btn-ghost" onClick={() => window.close()}>
                  Not now
                </button>
              </>
            )}
          </div>
        </li>

        <li className={`card p-5 ${consented ? '' : 'opacity-50'}`} aria-disabled={!consented}>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">
            Step 2 · optional {host.granted ? '· done' : ''}
          </p>
          <h2 className="mt-1 font-medium">Let Recall read the pages you visit</h2>
          <p className="muted mt-1 text-sm">
            This is what makes "that article explaining vector databases" findable, not just page titles. Chrome will ask
            you to allow Recall to "read and change your data on all websites". Recall only reads the text of eligible
            pages, and it never changes them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {host.granted ? (
              <span className="text-sm font-medium text-accent-700 dark:text-accent-400">✓ Page content indexing is on</span>
            ) : (
              <>
                <button className="btn-primary" disabled={!consented} onClick={() => host.request()}>
                  Enable page content
                </button>
                <button className="btn-ghost" disabled={!consented} onClick={() => update({ captureMode: 'metadata' })}>
                  {settings.captureMode === 'metadata' ? '✓ Using titles & addresses only' : 'Titles & addresses only'}
                </button>
              </>
            )}
          </div>
        </li>

        <li className={`card p-5 ${consented ? '' : 'opacity-50'}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">Step 3</p>
          <h2 className="mt-1 font-medium">Browse normally, then search</h2>
          <p className="muted mt-1 text-sm">
            Click the Recall icon, press <kbd>Alt+Shift+R</kbd>, or type <kbd>rc</kbd> and a space in the address bar.
          </p>
          <button className="btn-secondary mt-3" disabled={!consented} onClick={() => openExtensionPage('/search.html')}>
            Try a search
          </button>
        </li>
      </ol>
    </div>
  );
}

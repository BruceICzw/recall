import { useState, type ReactNode } from 'react';
import { Logo } from '../../components/Logo';
import { Toggle } from '../../components/Toggle';
import { TrashIcon } from '../../components/Icons';
import {
  openExtensionPage,
  useExcludedDomains,
  useHostAccess,
  useIndexStats,
  useModelStatus,
  useSettings,
  useStorageEstimate,
} from '../../hooks/useRecall';
import { addExcludedDomain, removeExcludedDomain } from '../../database/settings';
import { clearAllData, deletePagesForDomain } from '../../database/pages';
import { retryFailedJobs } from '../../database/chunks';
import { MODELS, getModel } from '../../modules/embeddings/models';
import { buildExport, downloadBlob } from '../../modules/privacy/export';
import { send } from '../../services/messaging';
import { formatBytes, formatRelative } from '../../utils/time';
import { PRIVACY_URL, REPO_URL } from '../../utils/links';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="muted mt-0.5 text-sm">{description}</p>}
      <div className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}

const PERMISSIONS: [string, string][] = [
  ['history', 'Import and monitor your browsing history metadata (URLs, titles, visit times).'],
  ['Read pages you visit (optional)', 'Extract readable text from eligible pages so you can search their content.'],
  ['scripting / tabs', 'Inject the one-shot capture script into eligible tabs and read their URL, title and Incognito flag.'],
  ['offscreen', 'Run the embedding model in a hidden extension page (MV3 service workers cannot).'],
  ['unlimitedStorage', 'Keep your index in local IndexedDB without hitting the default quota.'],
  ['alarms', 'Resume interrupted indexing after browser restarts.'],
  ['favicon', 'Show site icons in results (served by Chrome locally).'],
];

export default function App() {
  const [settings, update] = useSettings();
  const stats = useIndexStats(settings.embeddingModel);
  const host = useHostAccess();
  const excluded = useExcludedDomains();
  const storage = useStorageEstimate();
  const model = useModelStatus(3000);
  const [domainInput, setDomainInput] = useState('');
  const [alsoDelete, setAlsoDelete] = useState(true);
  const [note, setNote] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [exportContent, setExportContent] = useState(true);
  const [exportEmbeddings, setExportEmbeddings] = useState(false);
  const [importing, setImporting] = useState(false);
  const info = getModel(settings.embeddingModel);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 4000);
  };

  const addDomain = async () => {
    const d = await addExcludedDomain(domainInput);
    if (!d) return flash('Enter a domain like example.com');
    setDomainInput('');
    if (alsoDelete) {
      const n = await deletePagesForDomain(d);
      flash(`Excluded ${d}${n ? ` and deleted ${n} stored page${n === 1 ? '' : 's'}` : ''}.`);
    } else flash(`Excluded ${d}. Future visits won't be indexed.`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-20 pt-8">
      <header className="flex items-center justify-between">
        <Logo />
        <button className="btn-secondary" onClick={() => openExtensionPage('/search.html')}>
          Open search
        </button>
      </header>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {note && (
        <div role="status" className="rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-900 dark:bg-accent-900/40 dark:text-accent-100">
          {note}
        </div>
      )}

      <Section title="Index" description="Everything below is stored only on this device.">
        <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-4">
          <Stat label="Pages remembered" value={stats?.pages.toLocaleString() ?? '—'} />
          <Stat label="With full content" value={stats?.withContent.toLocaleString() ?? '—'} />
          <Stat label="Queued for indexing" value={stats?.pendingJobs.toLocaleString() ?? '—'} />
          <Stat label="Storage used" value={storage ? formatBytes(storage.usage) : '—'} />
        </div>
        {!!stats?.failedJobs && (
          <div className="flex items-center justify-between py-3 text-sm">
            <span className="text-amber-700 dark:text-amber-400">{stats.failedJobs} pages failed to index.</span>
            <button
              className="btn-secondary"
              onClick={async () => {
                const n = await retryFailedJobs();
                await send({ target: 'background', type: 'settings-changed' }).catch(() => {});
                flash(`Retrying ${n} pages.`);
              }}
            >
              Retry
            </button>
          </div>
        )}
        <Toggle
          label="Pause indexing"
          description="Stop capturing and indexing new pages. Search keeps working."
          checked={settings.indexingPaused}
          onChange={(v) => update({ indexingPaused: v, pausedReason: v ? 'user' : undefined })}
        />
        <div className="py-3">
          <p className="text-sm font-medium">Content capture</p>
          <div className="mt-2 space-y-2 text-sm">
            {(
              [
                ['full', 'Full content', 'Readable page text, titles and descriptions. Best search quality.'],
                ['metadata', 'Metadata only', 'Just URL, title and visit time. No page text is read.'],
              ] as const
            ).map(([v, label, desc]) => (
              <label key={v} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="capture"
                  className="mt-1 accent-accent-600"
                  checked={settings.captureMode === v}
                  onChange={() => update({ captureMode: v })}
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="muted block text-xs">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium">Permission to read pages</p>
            <p className="muted text-xs">
              {host.granted ? 'Granted — Recall can read eligible pages you visit.' : 'Not granted — only titles and URLs are indexed.'}
            </p>
          </div>
          {host.granted ? (
            <button className="btn-secondary" onClick={() => host.revoke()}>
              Revoke
            </button>
          ) : (
            <button className="btn-primary" onClick={() => host.request()}>
              Grant access
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium">Import Chrome history</p>
            <p className="muted text-xs">
              Adds titles and URLs from the past{' '}
              <select
                aria-label="Import window"
                className="rounded border border-stone-300 bg-transparent px-1 dark:border-stone-700"
                value={settings.historyImportDays}
                onChange={(e) => update({ historyImportDays: Number(e.target.value) })}
              >
                {[30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              . Chrome doesn't keep page contents, so these become fully searchable when you revisit them.
              {settings.historyImportedAt && ` Last imported ${formatRelative(settings.historyImportedAt).toLowerCase()}.`}
            </p>
          </div>
          <button
            className="btn-secondary shrink-0"
            disabled={importing}
            onClick={async () => {
              setImporting(true);
              const r = await send<{ ok: boolean; imported?: number }>({ target: 'background', type: 'import-history' }).catch(() => null);
              setImporting(false);
              flash(r?.ok ? `Imported ${r.imported ?? 0} new pages.` : 'Import failed.');
            }}
          >
            {importing ? 'Importing…' : 'Import now'}
          </button>
        </div>
      </Section>

      <Section title="Privacy" description="Recall never sends your browsing data anywhere. There are no accounts, analytics or AI APIs.">
        <Toggle
          label="Skip sensitive sites"
          description="Don't read content on banking, payment, email, login and account pages, or any page with a password or card field. Their titles may still appear from history."
          checked={settings.skipSensitiveSites}
          onChange={(v) => update({ skipSensitiveSites: v })}
        />
        <Toggle
          label="Follow Chrome history deletions"
          description="When you delete history in Chrome, remove the same pages from Recall (saved pages are kept). Deleting in Recall never deletes Chrome history."
          checked={settings.syncHistoryDeletion}
          onChange={(v) => update({ syncHistoryDeletion: v })}
        />
        <div className="py-3">
          <p className="text-sm font-medium">Excluded websites</p>
          <p className="muted text-xs">Pages on these domains (and their subdomains) are never stored.</p>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addDomain();
            }}
          >
            <input className="input" placeholder="example.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} aria-label="Domain to exclude" />
            <button className="btn-primary shrink-0" type="submit">
              Exclude
            </button>
          </form>
          <label className="muted mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" className="accent-accent-600" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} />
            Also delete pages already stored from that domain
          </label>
          {excluded.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {excluded.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-sm dark:bg-stone-800">
                  {d}
                  <button className="btn-ghost px-1 py-0" aria-label={`Remove ${d}`} onClick={() => removeExcludedDomain(d)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="py-3">
          <p className="text-sm font-medium">Export your data</p>
          <div className="muted mt-1 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-accent-600" checked={exportContent} onChange={(e) => setExportContent(e.target.checked)} />
              Include page text
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-accent-600" checked={exportEmbeddings} onChange={(e) => setExportEmbeddings(e.target.checked)} />
              Include embeddings (large)
            </label>
          </div>
          <button
            className="btn-secondary mt-2"
            onClick={async () => {
              const blob = await buildExport({ includeContent: exportContent, includeEmbeddings: exportEmbeddings });
              downloadBlob(blob, `recall-export-${new Date().toISOString().slice(0, 10)}.json`);
            }}
          >
            Download JSON
          </button>
          <p className="muted mt-1 text-xs">The file contains your browsing history — store it somewhere safe.</p>
        </div>
        <div className="py-3">
          <p className="text-sm font-medium">Clear all indexed data</p>
          <p className="muted text-xs">Deletes every page, visit, chunk, embedding, saved page and recent search. Settings and exclusions are kept. Chrome's own history is not touched.</p>
          {!confirmClear ? (
            <button className="btn-secondary mt-2 text-red-600" onClick={() => setConfirmClear(true)}>
              <TrashIcon /> Clear all data…
            </button>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm dark:bg-red-950/40">
              <span className="text-red-800 dark:text-red-200">This can't be undone.</span>
              <button
                className="btn-danger"
                onClick={async () => {
                  await clearAllData();
                  setConfirmClear(false);
                  flash('All indexed data deleted.');
                }}
              >
                Delete everything
              </button>
              <button className="btn-ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Turn off Recall" description="Withdraw your consent: Recall stops recording and deletes everything it stored. You can set it up again later from the welcome page.">
        <div className="py-3">
          {!settings.consentedAt ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="muted">Recall is off.</span>
              <button className="btn-primary" onClick={() => openExtensionPage('/welcome.html')}>
                Set up Recall
              </button>
            </div>
          ) : !confirmOff ? (
            <button className="btn-secondary text-red-600" onClick={() => setConfirmOff(true)}>
              Turn off and delete my data…
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm dark:bg-red-950/40">
              <span className="text-red-800 dark:text-red-200">Everything Recall stored will be deleted.</span>
              <button
                className="btn-danger"
                onClick={async () => {
                  await update({ consentedAt: undefined, onboarded: false });
                  await clearAllData();
                  setConfirmOff(false);
                  flash('Recall is off and your data has been deleted.');
                }}
              >
                Turn off Recall
              </button>
              <button className="btn-ghost" onClick={() => setConfirmOff(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Embedding model" description="Runs entirely on this device with ONNX Runtime WebAssembly.">
        <div className="py-3">
          <label className="text-sm font-medium" htmlFor="model">
            Model
          </label>
          <select
            id="model"
            className="input mt-1"
            value={settings.embeddingModel}
            onChange={(e) => update({ embeddingModel: e.target.value })}
          >
            {Object.values(MODELS).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — ~{m.sizeMb} MB
              </option>
            ))}
          </select>
          <dl className="muted mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
            <dt>ID</dt>
            <dd className="font-mono">{info.id}</dd>
            <dt>Languages</dt>
            <dd>{info.languages}</dd>
            <dt>Dimensions</dt>
            <dd>{info.dims}</dd>
            <dt>License</dt>
            <dd>{info.license}</dd>
            <dt>Status</dt>
            <dd>
              {model
                ? `${model.state}${model.source ? ` · ${model.source}` : ''}${model.device ? ` · ${model.device}` : ''}${model.error ? ` — ${model.error}` : ''}`
                : 'not loaded (loads on demand)'}
            </dd>
            <dt>Vectors</dt>
            <dd>{stats ? `${stats.embeddings.toLocaleString()} of ${stats.chunks.toLocaleString()} chunks` : '—'}</dd>
          </dl>
          <p className="muted mt-2 text-xs">Switching models re-indexes everything in the background; search falls back to keywords until it finishes.</p>
        </div>
        <Toggle
          label="Allow model download"
          description="If the model isn't bundled with this build, download its weights once from huggingface.co. Only the model files are fetched — none of your data is sent."
          checked={settings.allowModelDownload}
          onChange={(v) => update({ allowModelDownload: v })}
        />
      </Section>

      <Section title="Permissions" description="What Recall can access and why.">
        <ul className="space-y-2 py-3 text-sm">
          {PERMISSIONS.map(([p, why]) => (
            <li key={p}>
              <span className="font-mono text-xs font-semibold">{p}</span>
              <span className="muted block text-xs">{why}</span>
            </li>
          ))}
          <li className="muted text-xs">Recall is disabled in Incognito and never reads passwords, cookies, form inputs or tokens.</li>
        </ul>
        {(PRIVACY_URL || REPO_URL) && (
          <p className="flex gap-4 py-3 text-sm">
            {PRIVACY_URL && (
              <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">
                Privacy policy
              </a>
            )}
            {REPO_URL && (
              <a className="underline" href={REPO_URL} target="_blank" rel="noreferrer">
                Source code
              </a>
            )}
          </p>
        )}
      </Section>
    </div>
  );
}

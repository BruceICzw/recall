import { useIndexStats, useHostAccess, useModelStatus, useSettings, openExtensionPage } from '../hooks/useRecall';

/** Compact indexing status (popup + search page). */
export function IndexingStatus({ compact }: { compact?: boolean }) {
  const [settings, update, loaded] = useSettings();
  const stats = useIndexStats(settings.embeddingModel);
  const host = useHostAccess();
  const model = useModelStatus(3000);

  if (!loaded) return null;
  if (!settings.consentedAt) {
    return (
      <div className={`${compact ? '' : 'card p-4'} rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200`}>
        Recall is off and isn't recording anything until you finish setup.
        <button className="btn-primary mt-2 w-full py-1 text-xs" onClick={() => openExtensionPage('/welcome.html')}>
          Finish setup
        </button>
      </div>
    );
  }

  const indexing = (stats?.pendingJobs ?? 0) > 0 && !settings.indexingPaused;
  let line: string;
  let tone = 'text-stone-500 dark:text-stone-400';
  if (settings.indexingPaused && settings.pausedReason === 'storage_full') {
    line = 'Indexing stopped: browser storage is full. Free space or delete data in Settings.';
    tone = 'text-red-600 dark:text-red-400';
  } else if (settings.indexingPaused) {
    line = 'Indexing paused';
    tone = 'text-amber-700 dark:text-amber-400';
  } else if (model?.state === 'loading') {
    line = `Loading on-device model${model.progress ? ` (${model.progress}%)` : ''}…`;
  } else if (model?.state === 'error') {
    line = 'Model unavailable — keyword search only';
    tone = 'text-amber-700 dark:text-amber-400';
  } else if (indexing) {
    line = `Indexing… ${stats!.pendingJobs.toLocaleString()} page${stats!.pendingJobs === 1 ? '' : 's'} queued`;
  } else {
    line = 'Up to date';
  }

  return (
    <div className={compact ? 'space-y-2' : 'card space-y-2 p-4'}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              settings.indexingPaused ? 'bg-amber-500' : indexing ? 'animate-pulse bg-accent-500' : 'bg-accent-600'
            }`}
          />
          <span className={tone}>{line}</span>
        </span>
        <button
          className="btn-ghost px-2 py-0.5 text-xs"
          onClick={() => update({ indexingPaused: !settings.indexingPaused, pausedReason: settings.indexingPaused ? undefined : 'user' })}
        >
          {settings.indexingPaused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {stats && (
        <p className="muted text-xs">
          {stats.pages.toLocaleString()} pages remembered · {stats.withContent.toLocaleString()} with full content
        </p>
      )}
      {host.granted === false && settings.captureMode === 'full' && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Only titles and URLs are searchable. Allow Recall to read pages you visit to search their content.
          <button className="btn-secondary mt-2 w-full py-1 text-xs" onClick={() => host.request()}>
            Enable content indexing
          </button>
        </div>
      )}
      {!compact && model?.state === 'error' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {model.error}{' '}
          <button className="underline" onClick={() => openExtensionPage('/options.html')}>
            Settings
          </button>
        </p>
      )}
    </div>
  );
}

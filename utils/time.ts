export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", "3 days ago", "12 Mar 2026". */
export function formatRelative(ts: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (ts >= today) return 'Today';
  if (ts >= today - DAY) return 'Yesterday';
  const days = Math.floor((today - startOfDay(ts)) / DAY);
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

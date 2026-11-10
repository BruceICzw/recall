import { DEFAULT_SETTINGS, type Settings } from '../types';
import { cleanDomainInput } from '../utils/url';
import { db } from './schema';

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as Settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}

export async function getExcludedDomains(): Promise<string[]> {
  return (await db.excluded_domains.toArray()).map((d) => d.domain);
}

export async function addExcludedDomain(input: string): Promise<string | null> {
  const domain = cleanDomainInput(input);
  if (!domain || !domain.includes('.')) return null;
  await db.excluded_domains.put({ domain, added_at: Date.now() });
  return domain;
}

export async function removeExcludedDomain(domain: string): Promise<void> {
  await db.excluded_domains.delete(domain);
}

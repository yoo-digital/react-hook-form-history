import type { FormHistoryStorage } from './storage';

/**
 * Deletes drafts not saved within `maxAgeMs`, including ones whose form is never
 * loaded again (renamed forms, other users). Call once at startup.
 */
export function removeExpiredDrafts(
  storage: FormHistoryStorage,
  maxAgeMs: number,
  now: () => number = Date.now,
): Promise<number> {
  return storage.removeOlderThan(now() - maxAgeMs);
}

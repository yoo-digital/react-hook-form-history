import { useEffect, useRef } from 'react';
import type { FormHistoryStorage } from './storage';
import { removeExpiredDrafts } from './sweep';

export type ExpiredDraftsCleanupProps = {
  storage: FormHistoryStorage;
  /** Drafts not saved within this many milliseconds are deleted. */
  maxAgeMs: number;
  /** Called if pruning fails. Defaults to `console.error`. */
  onError?: (error: unknown) => void;
};

/**
 * Renders nothing; on mount it deletes drafts not saved within `maxAgeMs`
 * (`removeExpiredDrafts`), including drafts of forms that are never opened again.
 * Runs again only if `storage` or `maxAgeMs` change, so create `storage` once at
 * module level; re-running is harmless.
 *
 * It is garbage collection, not what keeps forms from restoring stale drafts: pass
 * each form the same `maxAgeMs` and it discards expired drafts itself, so the order
 * in which this and the forms mount doesn't matter.
 */
export function ExpiredDraftsCleanup({
  storage,
  maxAgeMs,
  onError,
}: ExpiredDraftsCleanupProps): null {
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    // async so an adapter that throws synchronously also ends up in onError
    (async (): Promise<number> => removeExpiredDrafts(storage, maxAgeMs))().catch(
      (error: unknown) => {
        if (onErrorRef.current) onErrorRef.current(error);
        // oxlint-disable-next-line no-console -- default reporter when no onError is given
        else console.error('[form-history] removing expired drafts failed', error);
      },
    );
  }, [storage, maxAgeMs]);

  return null;
}

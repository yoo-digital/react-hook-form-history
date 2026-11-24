import type { FormHistoryStore } from '@yoo-digital/rhf-history';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import {
  persistFormHistory,
  type FormHistoryPersistence,
  type PersistOptions,
  type RecoveryCandidate,
} from './persistFormHistory';
import { DraftsClearedError, RecoveryUnavailableError } from './storage';

export type PersistStatus = 'restoring' | 'restored' | 'fresh';

/**
 * Persists `history` (and the form's values) via `options.storage` and restores it on mount.
 * Re-initialises when `key`, `version` or `storage` change; a new `RevisionKey` object with the
 * same content doesn't count as a change.
 *
 * With a `RevisionKey`, `recovery` holds a stale draft of the same document that the app can
 * preview, accept or discard. It becomes `null` again once accepted or discarded.
 */
export function usePersistedFormHistory<T extends FieldValues>(
  form: UseFormReturn<T>,
  history: FormHistoryStore,
  options: PersistOptions,
): { status: PersistStatus; clear: () => Promise<void>; recovery: RecoveryCandidate | null } {
  const [status, setStatus] = useState<PersistStatus>('restoring');
  const [recovery, setRecovery] = useState<RecoveryCandidate | null>(null);
  const persistence = useRef<FormHistoryPersistence | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const { storage, version } = options;
  // JSON for both shapes, so a string key can't collide with the encoding of a revision key.
  const keyId = JSON.stringify(
    typeof options.key === 'string'
      ? options.key
      : [options.key.scope, options.key.document, options.key.revision],
  );
  const { getValues } = form;

  useEffect(() => {
    const current = persistFormHistory({ getValues: () => getValues() }, history, {
      ...optionsRef.current,
      storage,
      version,
    });
    persistence.current = current;
    let active = true;
    void current.restored.then((wasRestored) => {
      if (active) setStatus(wasRestored ? 'restored' : 'fresh');
    });
    void current.candidate.then((candidate) => {
      if (!active || !candidate) return;
      setRecovery(
        clearWhenSpent(candidate, () => {
          if (active) setRecovery(null);
        }),
      );
    });
    return (): void => {
      active = false;
      setRecovery(null);
      current.dispose();
    };
  }, [getValues, history, storage, keyId, version]);

  const clear = useCallback(async () => {
    await persistence.current?.clear();
  }, []);

  return { status, clear, recovery };
}

/** Calls `onSpent` once the candidate succeeded, or turned out to be gone or halted. */
function clearWhenSpent(candidate: RecoveryCandidate, onSpent: () => void): RecoveryCandidate {
  const settle = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      if (error instanceof RecoveryUnavailableError || error instanceof DraftsClearedError)
        onSpent();
      throw error;
    }
    onSpent();
  };
  return {
    ...candidate,
    accept: (resolutions) => settle(() => candidate.accept(resolutions)),
    discard: () => settle(() => candidate.discard()),
  };
}

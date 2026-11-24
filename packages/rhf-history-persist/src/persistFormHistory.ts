import type { FormHistoryStore } from '@yoo-digital/rhf-history';
import {
  canUndo,
  canRedo,
  createHistory,
  diff,
  merge3,
  type MergeResult,
  type Resolutions,
} from '@yoo-digital/rhf-history/core';
import type { FieldValues } from 'react-hook-form';
import { isPersistedRecord } from './isPersistedRecord';
import {
  DraftsClearedError,
  isRevisionKey,
  RecoveryUnavailableError,
  type DraftKey,
  type RevisionKey,
  type FormHistoryStorage,
  type PersistedFormHistory,
} from './storage';

export type PersistOptions = {
  storage: FormHistoryStorage;
  /** Identifies the form, e.g. `profile:${userId}`. A `RevisionKey` also persists the base values. */
  key: DraftKey;
  /** Bump when the form's shape changes; older records are discarded instead of restored. */
  version: number;
  /** Delay after the last change before writing. */
  debounceMs?: number;
  /** Drafts older than this are discarded instead of restored. Never expire when omitted. */
  maxAgeMs?: number;
  /** Extra check before restoring, e.g. `(values) => v.is(Schema, values)`. */
  validate?: (values: FieldValues) => boolean;
  onError?: (error: unknown) => void;
  now?: () => number;
};

export type RecoveryPreview = MergeResult<FieldValues> & {
  /** `validate(merged)`; `true` when no `validate` option was given. `false` when the draft can't be merged at all. */
  valid: boolean;
};

/** A stale draft of the same document (another revision) that can be merged onto the open form. */
export type RecoveryCandidate = {
  revision: string;
  savedAt: number;
  /**
   * Merges the stale draft onto the form's current values. Pure: changes neither the form, its
   * history nor storage. Never throws for a draft with unsafe paths; it reports no changes and `valid: false`.
   */
  preview: (resolutions?: Resolutions) => RecoveryPreview;
  /**
   * Applies the merge, replaces the history with one undo entry (target values to merged values),
   * saves the form under the current revision and deletes the stale revisions. Rejects with
   * `RecoveryUnavailableError` when the stale draft is gone, already settled or can't be merged,
   * and with `DraftsClearedError` (halting persistence) when another context cleared all drafts.
   */
  accept: (resolutions?: Resolutions) => Promise<void>;
  /** Deletes the stale revisions; the form is untouched. */
  discard: () => Promise<void>;
};

export type FormHistoryPersistence = {
  /** Resolves with whether a persisted session was restored, once the restore attempt (and candidate detection) finished. */
  restored: Promise<boolean>;
  /** Resolves after the restore attempt: the newest usable stale draft for `RevisionKey` forms, else `null`. */
  candidate: Promise<RecoveryCandidate | null>;
  /** Writes pending changes immediately. */
  flush: () => Promise<void>;
  /** Deletes the persisted record, e.g. after a successful submit. */
  clear: () => Promise<void>;
  /** Stops listening; pending changes are flushed. */
  dispose: () => void;
};

type Form = { getValues: () => FieldValues };

type Base = FieldValues | undefined;

/**
 * Saves form values plus undo/redo history so a reload continues where the user left off.
 *
 * - Restores once on start, unless the user already made changes meanwhile.
 * - Saves debounced on history changes, and immediately when the page is hidden.
 * - Never writes before the restore attempt finished, so it can't clobber a saved session.
 */
export function persistFormHistory(
  form: Form,
  store: FormHistoryStore,
  {
    storage,
    key,
    version,
    debounceMs = 300,
    validate = () => true,
    maxAgeMs,
    // oxlint-disable-next-line no-console -- default reporter when no onError is given
    onError = (error) => console.error('[form-history] persistence failed', error),
    now = Date.now,
  }: PersistOptions,
): FormHistoryPersistence {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let ready = false;
  let disposed = false;
  let halted = false;
  let pending: Promise<void> = Promise.resolve();
  // Captured before the restore so it reflects the server values, not edits made later.
  let base: Base = isRevisionKey(key) ? structuredClone(form.getValues()) : undefined;

  const halt = (): void => {
    // Another tab cleared all drafts (logout): never write again, or we'd resurrect ours.
    halted = true;
    clearTimeout(timer);
    timer = undefined;
  };

  const write = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty || !ready || halted) return pending;
    dirty = false;
    const history = store.getHistory();
    const isEmpty = !canUndo(history) && !canRedo(history);
    const record: PersistedFormHistory = {
      version,
      savedAt: now(),
      values: form.getValues(),
      history,
    };
    if (base) record.base = base;
    // Issue the write synchronously: storages apply operations in call order, so a
    // `load` issued afterwards (e.g. by a remounted form) is guaranteed to see it.
    pending = (isEmpty ? storage.remove(key) : storage.save(key, record)).catch(
      (error: unknown) => {
        if (!(error instanceof DraftsClearedError)) return onError(error);
        halt();
      },
    );
    return pending;
  };

  const schedule = (): void => {
    dirty = true;
    if (!ready || halted) return;
    clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
  };

  /** Whether a record read from storage may be restored or offered for recovery. */
  const isUsable = (record: unknown): record is PersistedFormHistory => {
    if (!isPersistedRecord(record)) return false;
    const isExpired = maxAgeMs !== undefined && now() - record.savedAt > maxAgeMs;
    return !isExpired && record.version === version;
  };

  const restoreExact = async (): Promise<{ restored: boolean; missed: boolean }> => {
    try {
      const record = await storage.load(key);
      if (disposed) return { restored: false, missed: false };
      if (!record) return { restored: false, missed: true };
      // Unusable drafts are deleted even if the user has started editing meanwhile.
      // Corrupt or tampered records (e.g. a NaN `savedAt` that would never expire) are unusable too.
      if (!isUsable(record) || !validate(record.values)) {
        await storage.remove(key);
        return { restored: false, missed: true };
      }
      // Edits made while loading win over the stored session.
      if (canUndo(store.getHistory()) || canRedo(store.getHistory()))
        return { restored: false, missed: false };
      store.restore({ values: record.values, history: record.history });
      if (base && record.base) base = record.base;
      dirty = false;
      return { restored: true, missed: false };
    } catch (error) {
      onError(error);
      return { restored: false, missed: false };
    }
  };

  const findCandidate = async (current: RevisionKey): Promise<RecoveryCandidate | null> => {
    const stale = (await storage.listRevisions(current.scope, current.document))
      .filter(({ revision }) => revision !== current.revision)
      .sort(newestFirst);

    for (const { revision } of stale) {
      if (disposed) return null;
      const staleKey: RevisionKey = { ...current, revision };
      const record = await storage.load(staleKey);
      if (!record) continue;
      // Edits made meanwhile don't matter: recovering never overwrites them without confirmation.
      // A draft that can't be merged (e.g. unsafe paths) is as unusable as a corrupt one.
      if (!isUsable(record) || !record.base || !canMerge(record, form.getValues())) {
        await storage.remove(staleKey);
        continue;
      }
      return createCandidate(current, staleKey, record);
    }
    return null;
  };

  const createCandidate = (
    current: RevisionKey,
    staleKey: RevisionKey,
    detected: PersistedFormHistory,
  ): RecoveryCandidate => {
    let settled = false;
    let busy = false;

    /** Runs one settling operation at a time; the candidate is spent once it succeeds or is gone. */
    const settle = async (operation: () => Promise<void>): Promise<void> => {
      if (settled || busy || disposed) throw new RecoveryUnavailableError();
      busy = true;
      try {
        await operation();
        settled = true;
      } catch (error) {
        if (error instanceof RecoveryUnavailableError || error instanceof DraftsClearedError)
          settled = true;
        throw error;
      } finally {
        busy = false;
      }
    };

    const accept = async (resolutions?: Resolutions): Promise<void> => {
      // Re-read: another tab may have settled the candidate, and the record is untrusted again.
      const record = await storage.load(staleKey);
      if (disposed) throw new RecoveryUnavailableError();
      if (!record) throw new RecoveryUnavailableError();
      if (halted) throw new DraftsClearedError();
      if (!isUsable(record) || !record.base)
        throw new RecoveryUnavailableError('The draft to recover is unusable');

      const target = structuredClone(form.getValues());
      let result: MergeResult<FieldValues>;
      try {
        result = merge3(record.base, record.values, target, resolutions);
      } catch {
        throw new RecoveryUnavailableError('The draft to recover is unusable');
      }

      const patches = diff(target, result.merged);
      if (patches.length === 0) {
        // Nothing to apply: leave the form and its history alone, only drop the stale drafts.
        await storage.removeRevisions(current.scope, current.document, current.revision);
        return;
      }

      const history = { ...createHistory(), past: [{ patches }], updatedAt: now() };
      store.restore({ values: result.merged, history });
      // Both calls are issued synchronously and in this order (see `write`). The restore above
      // scheduled a debounced save that this direct save supersedes.
      const removing = storage.removeRevisions(current.scope, current.document, current.revision);
      const saving = storage.save(current, {
        version,
        savedAt: now(),
        values: form.getValues(),
        history: store.getHistory(),
        base: base!,
      });
      clearTimeout(timer);
      timer = undefined;
      dirty = false;
      const operations = Promise.allSettled([removing, saving]);
      pending = operations.then(() => undefined);
      const [removed, saved] = await operations;
      if (saved.status === 'rejected' && saved.reason instanceof DraftsClearedError) {
        halt();
        throw saved.reason;
      }
      const failure = removed.status === 'rejected' ? removed : saved;
      if (failure.status === 'rejected') {
        // Let the debounced writer retry the save.
        schedule();
        throw failure.reason;
      }
    };

    return {
      revision: staleKey.revision,
      savedAt: detected.savedAt,
      preview: (resolutions) => previewMerge(detected, form.getValues(), validate, resolutions),
      accept: (resolutions) => settle(() => accept(resolutions)),
      discard: () =>
        settle(() => storage.removeRevisions(current.scope, current.document, current.revision)),
    };
  };

  let resolveRestored!: (restored: boolean) => void;
  const restored = new Promise<boolean>((resolve) => (resolveRestored = resolve));

  // `ready` is set only once the restore attempt and candidate detection are done, so no
  // save can happen before either, and `restored` implies `ready`.
  const candidate = (async (): Promise<RecoveryCandidate | null> => {
    let wasRestored = false;
    try {
      const exact = await restoreExact();
      wasRestored = exact.restored;
      if (!exact.missed || !isRevisionKey(key) || disposed) return null;
      try {
        return await findCandidate(key);
      } catch (error) {
        onError(error);
        return null;
      }
    } finally {
      ready = true;
      if (dirty && !disposed) schedule();
      resolveRestored(wasRestored);
    }
  })();

  const stopChanges = store.subscribeChanges(schedule);
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') void write();
  };
  const hasDocument = typeof document !== 'undefined';
  if (hasDocument) document.addEventListener('visibilitychange', onHidden);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', write);

  return {
    restored,
    candidate,
    flush: write,
    clear: async () => {
      clearTimeout(timer);
      dirty = false;
      pending = (
        isRevisionKey(key) ? storage.removeRevisions(key.scope, key.document) : storage.remove(key)
      ).catch(onError);
      return pending;
    },
    dispose: () => {
      disposed = true;
      stopChanges();
      if (hasDocument) document.removeEventListener('visibilitychange', onHidden);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', write);
      void write();
    },
  };
}

const rank = (savedAt: number): number => (Number.isFinite(savedAt) ? savedAt : -Infinity);

const newestFirst = (a: { savedAt: number }, b: { savedAt: number }): number =>
  rank(a.savedAt) === rank(b.savedAt) ? 0 : rank(a.savedAt) < rank(b.savedAt) ? 1 : -1;

function canMerge(record: PersistedFormHistory, target: FieldValues): boolean {
  try {
    merge3(record.base, record.values, target);
    return true;
  } catch {
    return false;
  }
}

function previewMerge(
  detected: PersistedFormHistory,
  target: FieldValues,
  validate: (values: FieldValues) => boolean,
  resolutions?: Resolutions,
): RecoveryPreview {
  try {
    const result = merge3(detected.base!, detected.values, target, resolutions);
    return { ...result, valid: validate(result.merged) };
  } catch {
    return { merged: structuredClone(target), applied: [], conflicts: [], valid: false };
  }
}

import type { FormHistoryStorage, RevisionKey } from '@yoo-digital/rhf-history-persist';
import { createIndexedDbStorage } from '@yoo-digital/rhf-history-persist/indexeddb';

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const profileDraftKey = (revision: string): RevisionKey => ({
  scope: 'demo-user',
  document: 'profile',
  revision,
});

const changeListeners = new Set<() => void>();
const notify = (): void => changeListeners.forEach((listener) => listener());

/** Forwards a storage call unchanged and notifies listeners once it settled. */
const notifying =
  <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
  (...args: A): Promise<R> => {
    const result = operation(...args);
    result.then(notify, notify); // The caller handles a rejection.
    return result;
  };

const indexedDb = createIndexedDbStorage({ dbName: 'rfh-undo-redo' });

/**
 * IndexedDB storage that also reports every completed write or delete, so the demo
 * can show what is persisted. Wrapping an adapter is fine as long as each call is
 * forwarded synchronously: that keeps the call-order guarantee intact.
 */
export const draftStorage: FormHistoryStorage = {
  load: indexedDb.load,
  listRevisions: indexedDb.listRevisions,
  save: notifying(indexedDb.save),
  remove: notifying(indexedDb.remove),
  clearAll: notifying(indexedDb.clearAll),
  removeOlderThan: notifying(indexedDb.removeOlderThan),
  removeRevisions: notifying(indexedDb.removeRevisions),
};

/** Calls `listener` after any draft was saved or deleted. */
export function onDraftsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

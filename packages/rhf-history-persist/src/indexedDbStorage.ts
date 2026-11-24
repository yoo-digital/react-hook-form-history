import {
  DraftsClearedError,
  type DraftKey,
  type FormHistoryStorage,
  type PersistedFormHistory,
} from './storage';

const DB_VERSION = 3;
const META_STORE = 'meta';
const CLEAR_EPOCH_KEY = 'clearEpoch';
const SAVED_AT_INDEX = 'savedAt';

export type IndexedDbStorageOptions = {
  dbName?: string;
  storeName?: string;
  /** Injectable for tests and non-browser environments. Defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  /** Injectable alongside `indexedDB`; must come from the same implementation. Defaults to `globalThis.IDBKeyRange`. */
  IDBKeyRange?: typeof IDBKeyRange;
};

/** A revision key is stored as the array key `[scope, document, revision]`; string keys stay strings. */
const toIdbKey = (key: DraftKey): IDBValidKey =>
  typeof key === 'string' ? key : [key.scope, key.document, key.revision];

/**
 * Persists form histories in IndexedDB.
 *
 * Unlike localStorage, IndexedDB uses the structured clone algorithm, so `Date`,
 * `File`, `Blob`, `Map` etc. in form values survive a reload unchanged, writes are
 * async (no main-thread blocking on large forms) and quotas are much larger.
 *
 * Revision keys are array keys in the same store. IndexedDB sorts strings before arrays, so they
 * never collide with string keys, and all revisions of one document form a contiguous key range.
 *
 * Records are indexed by `savedAt`, so expired drafts can be removed without reading them.
 *
 * `clearAll` bumps a persistent clear epoch. Each instance remembers the epoch it saw when it
 * first opened the database, and `save` rejects with `DraftsClearedError` once another
 * context has cleared, so a stale tab can't re-create drafts after a logout.
 *
 * The connection is opened lazily and reused. If another tab upgrades the database,
 * the connection is closed and reopened on the next call (the remembered epoch is kept).
 */
export function createIndexedDbStorage({
  dbName = 'form-history',
  storeName = 'histories',
  indexedDB = globalThis.indexedDB,
  IDBKeyRange: KeyRange = globalThis.IDBKeyRange,
}: IndexedDbStorageOptions = {}): FormHistoryStorage {
  let connection: Promise<IDBDatabase> | undefined;
  // Read once on first open and never re-read on reopen, which would forgive a stale tab.
  let epoch: number | undefined;

  const open = (): Promise<IDBDatabase> => {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!indexedDB) throw new Error('IndexedDB is not available in this environment');
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = (): void => upgrade(request, storeName);
      request.onsuccess = (): void => {
        const db = request.result;
        db.onversionchange = (): void => {
          db.close();
          connection = undefined;
        };
        if (epoch !== undefined) return resolve(db);
        readClearEpoch(db).then(
          (stored) => {
            epoch ??= stored;
            resolve(db);
          },
          (error: unknown) => {
            db.close();
            reject(error);
          },
        );
      };
      request.onerror = (): void => reject(request.error);
      request.onblocked = (): void => reject(new Error(`Opening IndexedDB "${dbName}" is blocked`));
    }).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
    return connection;
  };

  const transact = async <R>(
    mode: IDBTransactionMode,
    storeNames: string[],
    operation: (transaction: IDBTransaction) => IDBRequest<R> | (() => R),
  ): Promise<R> => {
    const db = await open();
    return new Promise<R>((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      const outcome = operation(transaction);
      // Resolve on transaction completion so writes are durable before we report success.
      transaction.oncomplete = (): void =>
        resolve(typeof outcome === 'function' ? outcome() : outcome.result);
      transaction.onerror = (): void => reject(transaction.error);
      transaction.onabort = (): void =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  /** `operation` returns the request whose result to resolve with, or a getter for the result. */
  const run = <R>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<R> | (() => R),
  ): Promise<R> =>
    transact(mode, [storeName], (transaction) => operation(transaction.objectStore(storeName)));

  // Every `[scope, document, <string revision>]`; the upper bound `[]` sorts after any string.
  const documentRange = (scope: string, document: string): IDBKeyRange =>
    KeyRange.bound([scope, document], [scope, document, []]);

  return {
    load: (key) =>
      run(
        'readonly',
        (store) => store.get(toIdbKey(key)) as IDBRequest<PersistedFormHistory | undefined>,
      ),
    save: async (key, record) => {
      let cleared = false;
      try {
        await transact('readwrite', [storeName, META_STORE], (transaction) => {
          const read = transaction.objectStore(META_STORE).get(CLEAR_EPOCH_KEY);
          read.onsuccess = (): void => {
            if (((read.result as number | undefined) ?? 0) === epoch) {
              transaction.objectStore(storeName).put(record, toIdbKey(key));
            } else {
              cleared = true;
              transaction.abort();
            }
          };
          return read;
        });
      } catch (error) {
        throw cleared ? new DraftsClearedError() : error;
      }
    },
    remove: (key) => run('readwrite', (store) => store.delete(toIdbKey(key))),
    clearAll: async () => {
      const previous = epoch;
      try {
        await transact('readwrite', [storeName, META_STORE], (transaction) => {
          transaction.objectStore(storeName).clear();
          const meta = transaction.objectStore(META_STORE);
          const read = meta.get(CLEAR_EPOCH_KEY);
          read.onsuccess = (): void => {
            epoch = ((read.result as number | undefined) ?? 0) + 1;
            meta.put(epoch, CLEAR_EPOCH_KEY);
          };
          return read;
        });
      } catch (error) {
        epoch = previous;
        throw error;
      }
    },
    removeOlderThan: (timestamp) =>
      run('readwrite', (store) => {
        let removed = 0;
        // The index is sorted by `savedAt`, so stop at the first record that isn't expired.
        const cursor = store.index(SAVED_AT_INDEX).openKeyCursor();
        cursor.onsuccess = (): void => {
          if (!cursor.result || (cursor.result.key as number) >= timestamp) return;
          store.delete(cursor.result.primaryKey);
          removed++;
          cursor.result.continue();
        };
        return () => removed;
      }),
    listRevisions: (scope, document) =>
      run('readonly', (store) => {
        const revisions: Array<{ revision: string; savedAt: number }> = [];
        const cursor = store.openCursor(documentRange(scope, document));
        cursor.onsuccess = (): void => {
          if (!cursor.result) return;
          revisions.push({
            revision: (cursor.result.key as [string, string, string])[2],
            savedAt: (cursor.result.value as PersistedFormHistory).savedAt,
          });
          cursor.result.continue();
        };
        return () => revisions;
      }),
    removeRevisions: (scope, document, keep) =>
      run('readwrite', (store) => {
        if (keep === undefined) return store.delete(documentRange(scope, document));
        // Two ranges around `keep`, in one transaction.
        const below = KeyRange.bound([scope, document], [scope, document, keep], false, true);
        const above = KeyRange.bound([scope, document, keep], [scope, document, []], true, false);
        store.delete(below);
        return store.delete(above);
      }),
  };
}

/** Idempotent so it upgrades any older version in place (v1 had no `savedAt` index). */
function upgrade(request: IDBOpenDBRequest, storeName: string): void {
  const store = request.result.objectStoreNames.contains(storeName)
    ? request.transaction!.objectStore(storeName)
    : request.result.createObjectStore(storeName);
  if (!store.indexNames.contains(SAVED_AT_INDEX)) store.createIndex(SAVED_AT_INDEX, 'savedAt');
  if (!request.result.objectStoreNames.contains(META_STORE))
    request.result.createObjectStore(META_STORE);
}

function readClearEpoch(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    // Throws e.g. for a database at this version created by other code without the meta store.
    const read = db
      .transaction(META_STORE, 'readonly')
      .objectStore(META_STORE)
      .get(CLEAR_EPOCH_KEY);
    read.onsuccess = (): void => resolve((read.result as number | undefined) ?? 0);
    read.onerror = (): void => reject(read.error);
  });
}

import type { History } from '@yoo-digital/rhf-history/core';
import type { FieldValues } from 'react-hook-form';

/** What gets persisted for one form: enough to restore its values and undo/redo stacks. */
export type PersistedFormHistory = {
  /** App-defined schema version; records with a different version are discarded on load. */
  version: number;
  savedAt: number;
  values: FieldValues;
  history: History;
  /** Server values the draft was started from; only written for `RevisionKey` drafts. */
  base?: FieldValues;
};

/** A draft of one revision of one server document, per user scope. */
export type RevisionKey = { scope: string; document: string; revision: string };
/** Plain string keys behave exactly as before (no base values, no recovery). */
export type DraftKey = string | RevisionKey;

export const isRevisionKey = (key: DraftKey): key is RevisionKey => typeof key !== 'string';

/** Rejected by `save` once another context (e.g. a second tab) has cleared all records. */
export class DraftsClearedError extends Error {
  constructor(message = 'Drafts were cleared by another context') {
    super(message);
    this.name = 'DraftsClearedError';
  }
}

/** Rejected by a recovery candidate's `accept` or `discard` when its stale draft is gone or already settled. */
export class RecoveryUnavailableError extends Error {
  constructor(message = 'The draft to recover is no longer available') {
    super(message);
    this.name = 'RecoveryUnavailableError';
  }
}

/**
 * Async key/value storage for persisted form histories.
 *
 * Operations must take effect in call order: a `load` called after a `save`
 * for the same key must observe that save, even if the save hasn't resolved yet.
 */
export type FormHistoryStorage = {
  load: (key: DraftKey) => Promise<PersistedFormHistory | undefined>;
  /**
   * An adapter shared across contexts may reject with `DraftsClearedError` once another
   * context called `clearAll`; callers must then stop saving through this instance.
   */
  save: (key: DraftKey, record: PersistedFormHistory) => Promise<void>;
  remove: (key: DraftKey) => Promise<void>;
  /**
   * Deletes every record, e.g. on logout. Unmount forms first: a still-mounted form
   * keeps its in-memory history and its next save would re-create its record.
   */
  clearAll: () => Promise<void>;
  /** Deletes records with `savedAt < timestamp` and resolves with the number removed. */
  removeOlderThan: (timestamp: number) => Promise<number>;
  /** Revisions stored for (scope, document), any order. Never includes other documents or scopes. */
  listRevisions: (
    scope: string,
    document: string,
  ) => Promise<Array<{ revision: string; savedAt: number }>>;
  /** Deletes every revision of (scope, document) except `keep`, if given. */
  removeRevisions: (scope: string, document: string, keep?: string) => Promise<void>;
};

/** In-memory storage, useful for tests and SSR. */
export function createMemoryStorage(): FormHistoryStorage {
  // Keyed by `JSON.stringify(key)`: a JSON string for string keys, a JSON object for revision keys.
  const records = new Map<string, { key: DraftKey; record: PersistedFormHistory }>();
  return {
    load: async (key) => {
      const entry = records.get(JSON.stringify(key));
      return entry && structuredClone(entry.record);
    },
    save: async (key, record) =>
      void records.set(JSON.stringify(key), { key, record: structuredClone(record) }),
    remove: async (key) => void records.delete(JSON.stringify(key)),
    clearAll: async () => records.clear(),
    removeOlderThan: async (timestamp) => {
      let removed = 0;
      for (const [id, { record }] of records) {
        if (record.savedAt < timestamp && records.delete(id)) removed++;
      }
      return removed;
    },
    listRevisions: async (scope, document) => {
      const revisions: Array<{ revision: string; savedAt: number }> = [];
      for (const { key, record } of records.values()) {
        if (typeof key !== 'string' && key.scope === scope && key.document === document) {
          revisions.push({ revision: key.revision, savedAt: record.savedAt });
        }
      }
      return revisions;
    },
    removeRevisions: async (scope, document, keep) => {
      for (const [id, { key }] of records) {
        if (
          typeof key !== 'string' &&
          key.scope === scope &&
          key.document === document &&
          key.revision !== keep
        ) {
          records.delete(id);
        }
      }
    },
  };
}

/** Storage that persists nothing; lets a form opt out of persistence. */
export const nullStorage: FormHistoryStorage = {
  load: async () => undefined,
  save: async () => {},
  remove: async () => {},
  clearAll: async () => {},
  removeOlderThan: async () => 0,
  listRevisions: async () => [],
  removeRevisions: async () => {},
};

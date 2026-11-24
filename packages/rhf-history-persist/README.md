# @yoo-digital/rhf-history-persist

Draft persistence for [`@yoo-digital/rhf-history`](https://www.npmjs.com/package/@yoo-digital/rhf-history): keep a react-hook-form's values **and** its undo history across reloads, in IndexedDB or your own storage, and recover drafts of an older server revision onto a newer one.

[![npm version](https://img.shields.io/npm/v/@yoo-digital/rhf-history-persist)](https://www.npmjs.com/package/@yoo-digital/rhf-history-persist)
[![bundle size](https://deno.bundlejs.com/badge?q=@yoo-digital/rhf-history-persist)](https://bundlejs.com/?q=@yoo-digital/rhf-history-persist)
[![CI](https://github.com/yoo-digital/react-hook-form-history/actions/workflows/ci.yml/badge.svg)](https://github.com/yoo-digital/react-hook-form-history/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@yoo-digital/rhf-history-persist)](https://github.com/yoo-digital/react-hook-form-history/blob/main/LICENSE)

## Why

- **Undo survives a reload.** Restores the form values and the undo/redo stacks recorded by `@yoo-digital/rhf-history`, so undo keeps working after a refresh.
- **IndexedDB adapter** (keeps `Date`, `File`, `Blob`), debounced saves, flush on page hide, versioned drafts, expiry and a clear-all for logout that also stops other tabs from resurrecting drafts.
- **Recovery across revisions.** Drafts of an older server revision can be recovered onto the newer one with a three-way merge.
- **Pluggable storage.** Bring your own adapter (e.g. a server) by implementing `FormHistoryStorage`.

## Install

```sh
pnpm add @yoo-digital/rhf-history @yoo-digital/rhf-history-persist react-hook-form
# npm install @yoo-digital/rhf-history @yoo-digital/rhf-history-persist react-hook-form
# yarn add @yoo-digital/rhf-history @yoo-digital/rhf-history-persist react-hook-form
```

Peer dependencies: `@yoo-digital/rhf-history` (same version), `react >=18` and `react-hook-form ^7.55.0`. Set up undo/redo first; see the [`@yoo-digital/rhf-history` README](https://www.npmjs.com/package/@yoo-digital/rhf-history).

## Persisting drafts

```tsx
import { createIndexedDbStorage } from '@yoo-digital/rhf-history-persist/indexeddb'
import { ExpiredDraftsCleanup, usePersistedFormHistory } from '@yoo-digital/rhf-history-persist'

const MAX_AGE = 7 * 24 * 60 * 60 * 1000
export const storage = createIndexedDbStorage({ dbName: 'my-app' })

// anywhere near the root: drops drafts nobody came back to
<ExpiredDraftsCleanup storage={storage} maxAgeMs={MAX_AGE} />

// inside the form component, after useFormHistory:
const draft = usePersistedFormHistory(form, history, {
  storage,
  key: `profile:${userId}`, // scope drafts per user
  version: 1, // bump when the form shape changes; old drafts are discarded
  maxAgeMs: MAX_AGE,
})

// draft.status: 'restoring' | 'restored' | 'fresh'
// draft.clear(): deletes the stored draft (e.g. after a successful submit or "Discard")
```

> **⚠️ Private data: clear drafts on logout.** Drafts are stored unencrypted in the user's browser and outlive the session. If a form can contain personal or confidential information, call `storage.clearAll()` on logout (after unmounting the forms, see **Logout** below) so the next person using that browser can't restore it. Never persist forms that hold secrets such as passwords or card numbers.

Behaviour:

- **Restore** happens once on mount: values are applied with `reset(values, { keepDefaultValues: true })` and the undo/redo stacks are replaced, so undo and redo keep working across a reload. The restore is not recorded as an undo step.
- **Nothing is restored** (and the stored draft is deleted) if it is malformed (e.g. a non-numeric `savedAt`, a broken history, or a patch path containing `__proto__`, `constructor` or `prototype`), its `version` differs, `validate(values)` returns `false`, or it is older than `maxAgeMs`. Nothing is restored either if the user edited while loading; their edits win.
- **Saving** happens `debounceMs` (default 300) after the last change, and immediately on `visibilitychange` to hidden, `pagehide` and unmount. Nothing is written before the restore attempt has finished. An empty history deletes the draft instead of saving it.
- **What is stored** per key: `{ version, savedAt, values, history }`, the current values once plus at most `limit` patch entries, overwritten on each save.
- **Versioning.** Bump `version` whenever the form's shape changes. Use `validate` (e.g. `(values) => v.is(Schema, values)`) as a second line of defence. It checks the current `values` only; values inside the undo/redo stack are checked structurally, not against your schema, so keep validating on submit (your resolver does).
- **Expiry.** `maxAgeMs` discards stale drafts when that form loads; `<ExpiredDraftsCleanup storage maxAgeMs />` removes them from storage up front, including drafts of forms that are never opened again. It renders nothing and prunes once on mount (again only if `storage` or `maxAgeMs` change, so create `storage` once at module level, not in render). Give each form the same `maxAgeMs`: forms then discard expired drafts themselves, so it doesn't matter whether the cleanup or a form mounts first. Outside React, call `removeExpiredDrafts(storage, maxAgeMs)` once at startup instead.
- **Per-user keys.** Include the user id in `key` so users on a shared browser never see each other's drafts.
- **Logout.** Unmount the forms first (their `dispose()` flushes a final save), then call `storage.clearAll()`. A still-mounted form keeps its in-memory history and its next save would re-create its record. With React, force the unmount synchronously:

```tsx
import { flushSync } from 'react-dom';

async function logout() {
  flushSync(() => setSession(null)); // unmounts every form, flushing their saves
  await storage.clearAll(); // storage applies calls in order, so the clear wins
}
```

- **Other tabs.** With the IndexedDB adapter, a form still open in another tab can't bring a draft back after `clearAll()`: its saves are rejected with `DraftsClearedError` and its persistence stops writing until that tab reloads. The other tab still shows the values on screen, so also log that tab out (e.g. via a `BroadcastChannel` or the `storage` event).

`usePersistedFormHistory` re-initialises when `key`, `version` or `storage` change; the other options are read from the latest render. `persistFormHistory(form, store, options)` is the same logic without React and returns `{ restored, candidate, flush, clear, dispose }`.

### Recovering drafts across revisions

Some apps edit server documents that carry a revision (an asset with an etag, say). If the document changes on the server while a user has unsaved edits, those edits belong to an older revision. Pass a revision key instead of a string and the library stores the server values the draft started from (its **base**), so it can offer to recover the edits onto the newer revision with a three-way merge.

```tsx
import {
  usePersistedFormHistory,
  type RecoveryCandidate,
  type Resolutions,
} from '@yoo-digital/rhf-history-persist';

const draft = usePersistedFormHistory(form, history, {
  storage,
  key: { scope: userId, document: asset.id, revision: asset.etag },
  version: 1,
});

// draft.recovery is null, or a candidate once a stale draft of this document was found
{
  draft.recovery && <RecoveryDialog recovery={draft.recovery} />;
}

function RecoveryDialog({ recovery }: { recovery: RecoveryCandidate }) {
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const { applied, conflicts, valid } = recovery.preview(resolutions); // pure, safe to call on every render
  return (
    <dialog open>
      <p>You have unsaved changes to an older version ({applied.length} can be recovered).</p>
      {conflicts.map((c) => (
        <fieldset key={c.path}>
          <legend>{c.path}</legend>
          <button onClick={() => setResolutions((r) => ({ ...r, [c.path]: 'mine' }))}>
            Keep mine: {String(c.mine)}
          </button>
          <button onClick={() => setResolutions((r) => ({ ...r, [c.path]: 'theirs' }))}>
            Keep server: {String(c.theirs)}
          </button>
        </fieldset>
      ))}
      <button
        disabled={!valid}
        onClick={() => recovery.accept(resolutions)}
      >
        Recover
      </button>
      <button onClick={() => recovery.discard()}>Discard</button>
    </dialog>
  );
}
```

How it works:

- **When to use a revision key.** Use it when the form edits a server document whose version you can identify. `scope` (e.g. the user id), `document` and `revision` are opaque strings; the library never interprets the revision. Plain string keys behave exactly as before: no base values are stored and no recovery happens.
- **On open**, an exact draft for the same `(scope, document, revision)` is restored as usual. Only if there is none does the library look for drafts of the same document at other revisions. It takes the newest usable one (by `savedAt`) and exposes it as `recovery`; unusable ones (malformed, no base, other `version`, expired) are deleted. Candidate detection finishes before persistence starts saving, and edits made while loading don't suppress the candidate; recovering never overwrites them without your confirmation.
- **The merge** compares the draft's base with its current values (the user's own changes) and applies them onto the form's values at the moment of `preview`/`accept` (the server values plus anything edited since). `preview(resolutions?)` returns `{ merged, applied, conflicts, valid }` and changes nothing; `valid` is `validate(merged)`.
- **Conflicts** are paths where both the draft and the server changed the base value to different results. They are reported at the outermost overlapping path (a draft edit to `address.city` against a server edit of `address` is one conflict at `address`). Arrays whose length differs are one whole-array path. An unresolved conflict keeps the server value; resolve with `{ [path]: 'mine' | 'theirs' }`.
- **`accept(resolutions?)`** applies the merge and replaces the history with one undo step, so a single undo reverts the whole recovery. It saves the form under the current revision and deletes the stale revisions. If the merge yields no change, only the stale drafts are deleted and the form and its history stay as they are. **`discard()`** deletes the stale revisions and leaves the form alone. After either succeeds, `recovery` is `null` again.
- **Clearing** with `draft.clear()` (e.g. after a successful submit) removes every revision of the document, not just the current one.
- **Errors.** `accept` and `discard` reject with `RecoveryUnavailableError` when the stale draft is gone or already settled (e.g. another tab got there first) or can't be merged; `recovery` then becomes `null`. `accept` rejects with `DraftsClearedError` when another context cleared all drafts; persistence then stops writing. Other storage errors reject too, and the candidate stays usable for a retry.
- **Cost.** Every save also writes the base, which roughly doubles record size and clone time. Measured with the in-memory adapter at 30,000 fields, a save costs about 6.4 ms with a base versus 3.2 ms without (0.62 ms vs 0.32 ms at 3,000 fields).
- **Base stays fixed.** It is captured when persistence starts, before any restore, and written unchanged on every save, so it reflects the server values the draft began from. Make sure the form holds the server values for the current revision when `usePersistedFormHistory` mounts.

### IndexedDB adapter

`createIndexedDbStorage({ dbName = 'form-history', storeName = 'histories', indexedDB, IDBKeyRange })` stores records with the structured clone algorithm, so `Date`, `File`, `Blob`, `Map` etc. survive unchanged. Writes are async and quotas are far larger than `localStorage`. The connection is opened lazily and reused, and reopened if another tab upgrades the database. Revision keys are stored as the array key `[scope, document, revision]` next to the string keys in the same store, so no schema upgrade is needed. When you inject a non-global `indexedDB` (e.g. fake-indexeddb's `IDBFactory`), inject its `IDBKeyRange` too. Without `indexedDB` in the environment (SSR), operations reject; use `createMemoryStorage()` or `nullStorage` there.

## Custom storage adapters

Implement `FormHistoryStorage`:

```ts
type DraftKey = string | { scope: string; document: string; revision: string };

type FormHistoryStorage = {
  load: (key: DraftKey) => Promise<PersistedFormHistory | undefined>;
  save: (key: DraftKey, record: PersistedFormHistory) => Promise<void>;
  remove: (key: DraftKey) => Promise<void>;
  clearAll: () => Promise<void>;
  removeOlderThan: (timestamp: number) => Promise<number>; // deletes savedAt < timestamp, resolves with the count
  // revisions stored for (scope, document); never other documents or scopes
  listRevisions: (
    scope: string,
    document: string,
  ) => Promise<Array<{ revision: string; savedAt: number }>>;
  // deletes every revision of (scope, document) except `keep`, if given
  removeRevisions: (scope: string, document: string, keep?: string) => Promise<void>;
};
```

Records saved under a revision key carry an extra `base` field. `listRevisions` and `removeRevisions` only concern revision keys; string-keyed drafts are never listed or removed by them.

**Operations must take effect in call order**: a `load` issued after a `save` for the same key must observe that save, even if the save has not resolved yet. A remounted form relies on this to see the previous instance's final write.

An adapter shared between tabs or devices should reject `save` with `DraftsClearedError` (exported) once another context has called `clearAll`, so a stale tab can't re-create drafts after a logout; persistence then stops writing silently. The IndexedDB adapter does this with a clear counter checked in the same transaction as the write.

For a remote backend, serialise calls through a queue:

```ts
import type {
  DraftKey,
  FormHistoryStorage,
  PersistedFormHistory,
} from '@yoo-digital/rhf-history-persist';

export function createServerStorage(baseUrl: string): FormHistoryStorage {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <R>(task: () => Promise<R>): Promise<R> => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };
  // A string key is one path segment; a revision key becomes /scope/document/revision.
  const url = (key: DraftKey) =>
    typeof key === 'string'
      ? `/${encodeURIComponent(key)}`
      : `/${[key.scope, key.document, key.revision].map(encodeURIComponent).join('/')}`;
  const documentUrl = (scope: string, document: string) =>
    `/${encodeURIComponent(scope)}/${encodeURIComponent(document)}`;
  const send = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (!response.ok) throw new Error(`Draft request failed: ${response.status}`);
    return response;
  };

  return {
    load: (key) =>
      enqueue(async () => {
        const response = await fetch(`${baseUrl}${url(key)}`);
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Draft request failed: ${response.status}`);
        return (await response.json()) as PersistedFormHistory;
      }),
    save: (key, record) =>
      enqueue(async () => {
        await send(url(key), { method: 'PUT', body: JSON.stringify(record) });
      }),
    remove: (key) =>
      enqueue(async () => {
        await send(url(key), { method: 'DELETE' });
      }),
    clearAll: () =>
      enqueue(async () => {
        await send('', { method: 'DELETE' });
      }),
    removeOlderThan: (timestamp) =>
      enqueue(async () => {
        const response = await send(`?olderThan=${timestamp}`, { method: 'DELETE' });
        return ((await response.json()) as { removed: number }).removed;
      }),
    listRevisions: (scope, document) =>
      enqueue(async () => {
        const response = await send(documentUrl(scope, document));
        return (await response.json()) as Array<{ revision: string; savedAt: number }>;
      }),
    removeRevisions: (scope, document, keep) =>
      enqueue(async () => {
        const query = keep === undefined ? '' : `?keep=${encodeURIComponent(keep)}`;
        await send(`${documentUrl(scope, document)}${query}`, { method: 'DELETE' });
      }),
  };
}
```

JSON transport drops non-JSON values such as `Date`; use IndexedDB if your forms contain them.

Built in: `createMemoryStorage()` (tests, SSR; clones on save and load) and `nullStorage` (opt a form out of persistence). A shared contract test suite (`src/storage.test.ts`) runs against every adapter, including the revision operations; add yours there if you contribute one.

## API reference

### `@yoo-digital/rhf-history-persist`

#### Hooks

| Export                    | Signature                                                                                                                              | Notes                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `usePersistedFormHistory` | `(form, store, options: PersistOptions) => { status: PersistStatus; clear: () => Promise<void>; recovery: RecoveryCandidate \| null }` | Restores on mount, saves on change. `store` comes from `useFormHistory`. `recovery` is only set for a `RevisionKey`. |

#### Functions, components and errors

| Export                                               | Description                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `persistFormHistory(form, store, options)`           | Framework-free persistence; returns `FormHistoryPersistence`.                                                                      |
| `<ExpiredDraftsCleanup storage maxAgeMs onError? />` | Renders nothing; prunes expired drafts on mount. `onError` defaults to `console.error`.                                            |
| `removeExpiredDrafts(storage, maxAgeMs, now?)`       | Resolves with the number of drafts removed.                                                                                        |
| `createMemoryStorage()`                              | In-memory `FormHistoryStorage`.                                                                                                    |
| `nullStorage`                                        | `FormHistoryStorage` that stores nothing.                                                                                          |
| `DraftsClearedError`                                 | Rejected by `save` (and a recovery's `accept`) once another context cleared all drafts; persistence stops writing when it sees it. |
| `RecoveryUnavailableError`                           | Rejected by a candidate's `accept`/`discard` when the stale draft is gone, already settled or can't be merged.                     |

`PersistOptions`:

| Option       | Default         | Description                                                                                                                                                      |
| ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`    | required        | A `FormHistoryStorage`.                                                                                                                                          |
| `key`        | required        | Identifies the form: a string such as `profile:${userId}`, or a `RevisionKey` `{ scope, document, revision }` that also stores base values and enables recovery. |
| `version`    | required        | App-defined schema version; other versions are discarded on load.                                                                                                |
| `debounceMs` | `300`           | Delay after the last change before writing.                                                                                                                      |
| `maxAgeMs`   | never expires   | Older drafts are discarded instead of restored.                                                                                                                  |
| `validate`   | accepts all     | `(values: FieldValues) => boolean`, an extra check before restoring.                                                                                             |
| `onError`    | `console.error` | Receives storage and restore errors; persistence never throws into your UI.                                                                                      |
| `now`        | `Date.now`      | Clock, injectable for tests.                                                                                                                                     |

`FormHistoryPersistence`: `restored: Promise<boolean>`, `candidate: Promise<RecoveryCandidate | null>`, `flush(): Promise<void>`, `clear(): Promise<void>` (for a `RevisionKey`, removes every revision of the document), `dispose(): void`. Both promises resolve after the restore attempt and candidate detection.

`RecoveryCandidate`:

| Member                  | Description                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `revision`, `savedAt`   | Revision and save time of the stale draft.                                                     |
| `preview(resolutions?)` | `{ merged, applied, conflicts, valid }`; pure, against the form's current values.              |
| `accept(resolutions?)`  | Applies the merge as one undo step, saves under the current revision, deletes stale revisions. |
| `discard()`             | Deletes stale revisions; the form is untouched.                                                |

`Resolutions` is `Record<path, 'mine' | 'theirs'>`; a `Conflict` is `{ path, base, mine, theirs }`.

`PersistStatus` is `'restoring' | 'restored' | 'fresh'`.

#### Types

`FormHistoryStorage`, `DraftKey`, `RevisionKey`, `PersistedFormHistory` (`{ version, savedAt, values, history, base? }`), `PersistOptions`, `FormHistoryPersistence`, `PersistStatus`, `RecoveryCandidate`, `RecoveryPreview`, and re-exported from `@yoo-digital/rhf-history`: `Resolutions`, `Conflict`, `MergeResult`.

### `@yoo-digital/rhf-history-persist/indexeddb`

| Export                             | Description                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIndexedDbStorage(options?)` | `IndexedDbStorageOptions`: `dbName` (`'form-history'`), `storeName` (`'histories'`), `indexedDB` (`globalThis.indexedDB`, injectable for tests), `IDBKeyRange` (`globalThis.IDBKeyRange`; inject it together with a non-global `indexedDB`). |

## Limitations

- **ESM only**, no CommonJS build. Node `>=18` for tooling.
- Persisted drafts hold form values unencrypted. Do not persist forms with secrets, and clear drafts on logout.
- JSON-based adapters drop non-JSON values such as `Date`; the IndexedDB adapter keeps them.

## Example

A runnable demo (profile form with draft persistence and revision recovery) lives in [`examples/react-vite`](https://github.com/yoo-digital/react-hook-form-history/tree/main/examples/react-vite).

## License

[MIT](https://github.com/yoo-digital/react-hook-form-history/blob/main/LICENSE)

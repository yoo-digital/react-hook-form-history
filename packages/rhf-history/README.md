# @yoo-digital/rhf-history

Undo/redo for [react-hook-form](https://react-hook-form.com) that stays fast on forms with thousands of fields.

[![npm version](https://img.shields.io/npm/v/@yoo-digital/rhf-history)](https://www.npmjs.com/package/@yoo-digital/rhf-history)
[![bundle size](https://deno.bundlejs.com/badge?q=@yoo-digital/rhf-history)](https://bundlejs.com/?q=@yoo-digital/rhf-history)
[![CI](https://github.com/yoo-digital/react-hook-form-history/actions/workflows/ci.yml/badge.svg)](https://github.com/yoo-digital/react-hook-form-history/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@yoo-digital/rhf-history)](https://github.com/yoo-digital/react-hook-form-history/blob/main/LICENSE)

## Why

- **Form-wide undo/redo.** One history for the whole form, driven by buttons and <kbd>Cmd/Ctrl+Z</kbd>, <kbd>Cmd/Ctrl+Shift+Z</kbd> and <kbd>Ctrl+Y</kbd>. It replaces the browser's per-input undo inside the form.
- **Sensible undo steps.** Consecutive keystrokes in one field merge into one step. Switching fields, pausing for 500 ms or blurring starts a new one.
- **Scales.** History stores per-field patches (`{ path, before, after }`), not form snapshots. Recording a change never re-renders the form, and undo writes back only the changed fields.
- **Works with what RHF does.** Text inputs, selects, checkboxes, `useFieldArray` add/remove, dirty state relative to the original defaults, and re-validation of restored fields after a submit.
- **Draft persistence, separately.** Save values **and** undo history across reloads with [`@yoo-digital/rhf-history-persist`](https://www.npmjs.com/package/@yoo-digital/rhf-history-persist) (IndexedDB adapter, expiry, recovery onto newer server revisions). Undo-only apps don't need it.
- **Headless.** No UI is shipped; you bring your own toolbar. The history logic is also available framework-free via `/core`.

## Install

```sh
pnpm add @yoo-digital/rhf-history react-hook-form
# npm install @yoo-digital/rhf-history react-hook-form
# yarn add @yoo-digital/rhf-history react-hook-form
```

Peer dependencies: `react >=18` and `react-hook-form ^7.55.0` (the library relies on `form.subscribe`, added in 7.55).

## Quick start

```tsx
import {
  useFormHistory,
  useFormHistoryState,
  useUndoRedoHotkeys,
  type FormHistoryStore,
} from '@yoo-digital/rhf-history';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';

type Values = { name: string; email: string };

// A small leaf component: only it re-renders when history changes, never the form.
function HistoryToolbar({ history }: { history: FormHistoryStore }) {
  const { canUndo, canRedo, undoCount, redoCount } = useFormHistoryState(history);
  return (
    <div
      role="toolbar"
      aria-label="History"
    >
      <button
        type="button"
        onClick={history.undo}
        disabled={!canUndo}
      >
        Undo ({undoCount})
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!canRedo}
      >
        Redo ({redoCount})
      </button>
    </div>
  );
}

export function ProfileForm() {
  const form = useForm<Values>({ defaultValues: { name: '', email: '' } });
  const history = useFormHistory(form); // stable store, records every change
  const formRef = useRef<HTMLFormElement>(null);
  useUndoRedoHotkeys(formRef, history);

  return (
    <form
      ref={formRef}
      onBlur={history.checkpoint} // blur ends the current undo step
      onSubmit={form.handleSubmit((values) => {
        console.log(values);
        history.clear(); // saved: current values become the new baseline
      })}
    >
      <HistoryToolbar history={history} />
      <input {...form.register('name')} />
      <input
        type="email"
        {...form.register('email')}
      />
      <button type="submit">Save</button>
    </form>
  );
}
```

## Keyboard shortcuts

`useUndoRedoHotkeys(ref, { undo, redo })` listens for `keydown` on the given element (pass the `<form>` ref) and calls `preventDefault()` for:

| Shortcut                    | Action |
| --------------------------- | ------ |
| <kbd>Cmd/Ctrl+Z</kbd>       | Undo   |
| <kbd>Cmd/Ctrl+Shift+Z</kbd> | Redo   |
| <kbd>Ctrl+Y</kbd>           | Redo   |

Combinations with <kbd>Alt</kbd> are ignored.

## What is one undo step?

- **Merge window.** Changes to the same field within `mergeWindowMs` (default 500 ms) of the previous one are coalesced into the last step. If the merged edit ends up back at the original value, the step is dropped.
- **`history.checkpoint()`** closes the current step so the next edit starts a new one. Call it yourself: on the form's `onBlur` (as above) and right before a field-array `append`/`remove`/`insert`, so the structural change is not merged into a preceding text edit.
- **`history.clear()`** drops all history and takes the current values as the new baseline. Call it after a successful save or `reset()`.
- **No-ops** (before equals after, compared deeply, `Date` by time) are never recorded.
- **Limit.** At most `limit` steps (default 100) are kept; the oldest are dropped first.
- A new edit after an undo discards the redo stack.
- Undo/redo apply changes with `setValue(path, value, { shouldDirty: true })`, so dirty state follows RHF. After the form has been submitted once, the restored paths are re-validated.

## Performance

- **Read history and form state in leaf components.** `useFormHistory` does not re-render its host component; read `useFormHistoryState(store)` in a child (like the toolbar above). Do the same for `formState.isDirty` / `errors` via `useFormState({ control })` so a field list of thousands of inputs is never re-rendered on a keystroke.
- **Patches, not snapshots.** A field change compares and clones only that field's value. Only changes without a field name (an external `reset()`, a submit) diff the whole form.
- **Measured** (`pnpm bench`, one `setValue` on a headless form):

| Fields | Without history | With history |
| -----: | --------------: | -----------: |
|    210 |        0.001 ms |     0.029 ms |
|    300 |        0.001 ms |     0.039 ms |
|  3,000 |        0.001 ms |      0.37 ms |
| 30,000 |        0.001 ms |       3.7 ms |

The history logic itself adds no measurable cost. The linear part is react-hook-form cloning all values for any `values` subscriber, which is inherent to its public subscription API.

## Persisting drafts

Draft persistence (values and undo history across reloads, an IndexedDB adapter, expiry, logout clearing and recovery onto a newer server revision) lives in its own package, [`@yoo-digital/rhf-history-persist`](https://www.npmjs.com/package/@yoo-digital/rhf-history-persist). It builds on the public `FormHistoryStore` API documented below.

## Framework-free usage

`@yoo-digital/rhf-history/core` is the pure, immutable history with no React and no react-hook-form dependency:

```ts
import { createHistory, diff, record, redo, undo } from '@yoo-digital/rhf-history/core';

let history = createHistory();

// `diff` lists leaf-level patches between two values.
const patches = diff({ name: 'a' }, { name: 'ab' }); // [{ path: 'name', before: 'a', after: 'ab' }]
history = record(history, patches, { group: 'name' });

const undone = undo(history); // { history, changes: [{ path: 'name', value: 'a' }] }
for (const { path, value } of undone.changes) write(path, value); // apply in order
history = undone.history;

history = redo(history).history;
```

The history is plain JSON as long as your values are, so it can be serialised as is.

## API reference

### `@yoo-digital/rhf-history`

#### Hooks

| Export                | Signature                                                                    | Notes                                                                              |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `useFormHistory`      | `(form: UseFormReturn<T>, options?: FormHistoryOptions) => FormHistoryStore` | Creates a stable store and records changes. Does not re-render on history changes. |
| `useFormHistoryState` | `(store: FormHistoryStore) => FormHistoryState`                              | `useSyncExternalStore` over `store.getState`. Use in leaf components.              |
| `useUndoRedoHotkeys`  | `(ref: RefObject<HTMLElement \| null>, { undo, redo }) => void`              | Mod+Z, Mod+Shift+Z, Ctrl+Y on `ref`'s element.                                     |

#### `FormHistoryOptions`

| Option          | Default | Description                                                 |
| --------------- | ------- | ----------------------------------------------------------- |
| `limit`         | `100`   | Maximum number of undo steps.                               |
| `mergeWindowMs` | `500`   | Edits of the same field within this window become one step. |

#### `FormHistoryStore`

| Member                         | Description                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `undo()` / `redo()`            | Step through history. No-ops when empty.                                          |
| `checkpoint()`                 | Closes the current edit group so the next edit is its own step.                   |
| `clear()`                      | Drops all history; current values become the baseline.                            |
| `getHistory()`                 | The current `History` (immutable).                                                |
| `getState()`                   | `{ canUndo, canRedo, undoCount, redoCount }`.                                     |
| `subscribe(listener)`          | Notified when `getState()` changes. Returns an unsubscribe function.              |
| `subscribeChanges(listener)`   | Notified on every recorded change, including coalesced ones. Used by persistence. |
| `restore({ values, history })` | Replaces form values and history. Not recorded as a step.                         |
| `connect()`                    | Starts recording; returns a stop function. `useFormHistory` calls this for you.   |
| `setOptions(options)`          | Updates `limit` / `mergeWindowMs`.                                                |

`createFormHistoryStore(form, options?)` builds a store without React. `form` needs `subscribe`, `getValues`, `setValue`, `trigger` and `reset` (a `useForm` result or `createFormControl()`); call `connect()` yourself.

#### Types

`FormHistoryOptions`, `FormHistoryState`, `FormHistoryStore`, `History`, `Entry`, `Patch`, `Change`, `Resolutions`, `Conflict`, `MergeResult`.

### `@yoo-digital/rhf-history/core`

| Export                                      | Signature                                                                                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createHistory`                             | `() => History`                                                                                                                                                                                                                                    |
| `record`                                    | `(history, patches: Patch[], options?: RecordOptions) => History`; coalesces, applies `limit`, drops no-ops, clears `future`.                                                                                                                      |
| `undo` / `redo`                             | `(history) => { history: History; changes: Change[] }`; apply `changes` to your state in order.                                                                                                                                                    |
| `seal`                                      | `(history) => History`; ends the current coalescing group.                                                                                                                                                                                         |
| `canUndo` / `canRedo`                       | `(history) => boolean`                                                                                                                                                                                                                             |
| `diff`                                      | `(before, after, path?) => Patch[]`; leaf patches. Arrays of different length become one whole-array patch.                                                                                                                                        |
| `deepEqual`                                 | `(a, b) => boolean`; handles `Date`, arrays and plain objects.                                                                                                                                                                                     |
| `merge3`                                    | `(base, mine, theirs, resolutions?) => { merged, applied, conflicts }`; three-way merge of `mine` onto `theirs`. Conflicts are reported at the outermost overlapping path and keep `theirs` unless resolved as `'mine'`. Never mutates its inputs. |
| `DEFAULT_LIMIT` / `DEFAULT_MERGE_WINDOW_MS` | `100` / `500`                                                                                                                                                                                                                                      |
| Types                                       | `History`, `Entry`, `Patch`, `Change`, `RecordOptions` (`group`, `now`, `mergeWindowMs`, `limit`, `isEqual`), `Conflict`, `Resolutions`, `MergeResult`                                                                                             |

Paths use react-hook-form's dot syntax (`skills.0.label`).

## Compatibility and limitations

- **ESM only**, no CommonJS build. Node `>=18` for tooling.
- **react-hook-form `^7.55.0`** (needs `form.subscribe`) and **React `>=18`** (`useSyncExternalStore`).
- RHF clones the entire form on every change once any `values` subscriber exists. This is inherent to its public API, so cost grows linearly with the number of fields (see [Performance](#performance)). Avoiding it would require RHF internals, which this library deliberately does not use.
- Arrays of different length are stored as one whole-array patch, so adding or removing a field-array row stores that array's before/after.
- Patch values are copied with `structuredClone`; values that cannot be cloned (functions, DOM nodes) cannot be in the form state.

## Example

A runnable demo (field array, a large-form stress test, plus draft persistence via `@yoo-digital/rhf-history-persist`) lives in [`examples/react-vite`](https://github.com/yoo-digital/react-hook-form-history/tree/main/examples/react-vite).

## License

[MIT](https://github.com/yoo-digital/react-hook-form-history/blob/main/LICENSE)

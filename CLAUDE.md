# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

pnpm monorepo for `@yoo-digital/rhf-history` (undo/redo for react-hook-form state, designed for forms with thousands of fields) and `@yoo-digital/rhf-history-persist` (optional draft persistence in IndexedDB or custom storage). React 19 + TS, Vitest 5, oxlint + oxfmt (YOO shared configs), tsdown.

## Layout

- `packages/rhf-history` — undo/redo (ESM-only, peer deps `react >=18`, `react-hook-form ^7.55.0`). Entry points: `.` (`src/index.ts`), `./core` (`src/core.ts`, pure history). Must never depend on the persist package.
- `packages/rhf-history-persist` — draft persistence (peer deps `@yoo-digital/rhf-history`, `react`, `react-hook-form`). Entry points: `.` (`src/index.ts`), `./indexeddb` (`src/indexeddb.ts`). Imports core only via `@yoo-digital/rhf-history` / `@yoo-digital/rhf-history/core`, never relative paths into the other package. Both packages are versioned together (`fixed` in `.changeset/config.json`).
- Each package's README is its npm showcase; keep it in sync with the API.
- `test/fixtures/` in each package — `ProfileForm`, `LargeForm`, `HistoryToolbar`, schemas, used by integration tests (`scale.test.tsx`, `reload.test.tsx`, ...). Small fixtures are duplicated on purpose; core's `ProfileForm` has no persistence. Tests live next to sources.
- `examples/react-vite` — demo SPA (shadcn/ui + Tailwind). Owns its own `HistoryToolbar`; the library ships no UI.
- `e2e/` — Playwright suite (Chromium) against a production build of the demo, served by `vite preview` on port 4173 (`playwright.config.ts` starts it; reused locally if already running). Specs in `e2e/tests/*.spec.ts`, shared locators in `e2e/tests/profile.ts`. Each test gets a fresh browser context (empty IndexedDB and sessionStorage); multi-tab specs open two pages in one context. Selectors use roles/labels; the demo has `data-testid` only where no accessible handle exists (`stored-draft`, `stored-draft-status`).
- `.changeset/`, `.github/workflows/` — Changesets config; CI (lint, typecheck, test, build, publint + attw; separate `e2e` job uploading `playwright-report` on failure) and release (npm trusted publishing with provenance, no npm token). Jobs set up pnpm and Node via `pnpm/setup` (pnpm from `packageManager`, Node from `.nvmrc`). Actions are referenced by tag and locked in `.github/workflows/actions.lock`; rerun `gh actions-lock` after changing any `uses:` (`gh actions-lock --verify` to check).

**Source condition**: package exports carry a dev-only `@yoo-digital/source` condition pointing at `src/*.ts` (stripped on publish by `publishConfig.exports`). The example's `vite.config.ts` (`resolve.conditions`) and `tsconfig.app.json` (`customConditions`), and the persist package's `vitest.config.ts` and `tsconfig.json`, enable it, so the example and tests use TS source without a build. A new entry point needs the condition in both `exports` and `publishConfig.exports`, plus a `tsdown.config.ts` entry.

## Commands

```sh
pnpm dev                    # example app (http://localhost:5173)
pnpm build                  # pnpm -r build
pnpm typecheck              # pnpm -r typecheck (tsc --noEmit; the only full typecheck)
pnpm lint                   # oxlint (root, type-aware via oxlint-tsgolint)
pnpm format                 # oxfmt (root); pnpm format:check in CI
pnpm test:run               # all tests once
pnpm bench                  # library benchmarks (both packages)
pnpm e2e                    # Playwright e2e suite (first run: pnpm -F e2e exec playwright install chromium)
pnpm -F e2e exec playwright test tests/undo-redo.spec.ts   # one spec; add --ui or --headed to watch
pnpm -F @yoo-digital/rhf-history test:run | bench | typecheck | build | check:pkg   # same for @yoo-digital/rhf-history-persist
pnpm -F @yoo-digital/rhf-history exec vitest run src/history.test.ts   # one file
pnpm -F @yoo-digital/rhf-history-persist exec vitest run src/storage.test.ts
pnpm -F @yoo-digital/rhf-history exec vitest run -t "should restore values"   # by test name
pnpm changeset              # add a release note for a user-facing change
```

Lint config (`oxlint.config.mts`) extends `@yoo-digital/oxlint-config-react` and `-vitest`; formatting comes from `@yoo-digital/oxfmt-config`. Extend them, don't turn rules off; the only inline disables are justified per-line ones (`-- reason`).

Vitest 5 benchmarks only run from `*.bench.ts` files and use the test-context fixture (`test('…', async ({ bench }) => bench.compare(bench(…), bench(…)))`); `bench` is not a top-level `vitest` export. For numbers: `pnpm -F @yoo-digital/rhf-history exec vitest bench --run --reporter=verbose`.

## Releasing

Changesets: user-facing library changes need a `pnpm changeset` file. Merging to `main` makes the release workflow open a "Version Packages" PR; merging that publishes to npm. Don't bump `version` by hand.

The release workflow builds `dist` in an unprivileged `build` job and publishes the uploaded artifact from a separate `release` job (`install --ignore-scripts`, no build), so no dependency code runs next to `id-token`. The release job also skips the pnpm store cache, so it never restores what other runs wrote. Hence there is no `prepack`; `prepublishOnly` only checks that `dist/` exists. Don't reintroduce a build step into the release job or package lifecycle scripts.

## Architecture

Three layers, each usable without the one above it:

1. **`rhf-history/src/history.ts`** (exported as `/core`) — pure, immutable, framework-free. History is a list of **patch entries** (`{ path, before, after }`, RHF dot-path syntax), not snapshots; the current values live in the form. `record` coalesces same-`group` changes within `mergeWindowMs` (group = field name), caps at `limit`, and drops no-op entries. `undo`/`redo` return `{ history, changes }` for the caller to apply. `diff` produces leaf patches (arrays of different length become one whole-array patch).
   - `merge.ts` (also in `/core`): `merge3(base, mine, theirs, resolutions)` three-way merge on leaf patches; powers draft recovery.
2. **`rhf-history/src/formHistoryStore.ts`** — binds history to an RHF instance, outside React state.
   - Records via `form.subscribe({ formState: { values: true } })`. With a `name`, only that field's subtree is compared and cloned; without one (external `reset()`, submit), the whole form is diffed against `shadow`.
   - `shadow` is a private mutable copy of the last known values used for `before`. Patches and shadow get **separate** `structuredClone`s, because shadow is mutated in place with `set()`.
   - Undo/redo applies each change with `setValue(path, …, { shouldDirty: true })` (works for `useFieldArray` roots), guarded by `isApplying` so applying isn't re-recorded. After a submit it re-validates only the changed paths.
   - Two listener sets: `subscribe` (only when `getState()` counts change; for `useSyncExternalStore`) and `subscribeChanges` (every commit; used by persistence).
3. **`rhf-history-persist/src/`** — drafts that survive a reload. Uses only core's public API (`getHistory`, `restore`, `subscribeChanges`, `/core` functions).
   - `storage.ts` holds the `FormHistoryStorage` contract plus memory and null adapters. `indexedDbStorage.ts` is the IndexedDB adapter (`/indexeddb` entry).
   - `persistFormHistory.ts` holds the save and restore logic, with no React. `usePersistedFormHistory.ts` is the hook around it. `sweep.ts` is `removeExpiredDrafts`; `ExpiredDraftsCleanup.ts` is a render-nothing component that calls it on mount.
   - A record is `{ version, savedAt, values, history }`: the current values plus every patch.

React glue: `useFormHistory` returns a stable store and does **not** re-render on history changes; read state with `useFormHistoryState(store)` in a leaf component (see `test/fixtures/HistoryToolbar.tsx`). `useUndoRedoHotkeys` binds Mod+Z / Mod+Shift+Z / Ctrl+Y on the form element.

`test/fixtures/ProfileForm.tsx` is the realistic fixture (field array, persistence, Discard). `test/fixtures/LargeForm.tsx` is a stress test with `rowCount * 3` fields, wrapped in a `Profiler` so tests can assert the field list never re-renders. The user-facing demo is `examples/react-vite/src/form/`.

## Invariants that are easy to break

- **No form-level re-renders.** Don't read `formState.isDirty`/`errors` or history state in the component that owns `useForm` for large forms; read them in leaf components via `useFormState`/`useFormHistoryState`. `packages/rhf-history/src/scale.test.tsx` enforces this using `test/fixtures/LargeForm`.
- **Storage operations must take effect in call order** (documented on `FormHistoryStorage`). `persistFormHistory` issues storage calls synchronously (no `.then` chaining) so a remounted form's `load` sees the previous instance's final save. Any new adapter (e.g. server) must preserve this.
- **Cross-tab clear epoch.** `clearAll` in the IndexedDB adapter bumps `meta.clearEpoch`; each adapter instance remembers the epoch from its first open (never re-read on reopen) and `save` rejects with `DraftsClearedError` if it changed, checked in the same transaction as the `put`. `persistFormHistory` halts on that error without calling `onError`. This is what stops another tab from resurrecting drafts after logout.
- **Restored records are untrusted.** `persistFormHistory` runs `isPersistedRecord` (structure, finite `savedAt`, no `__proto__`/`constructor`/`prototype` path segments) before expiry/version/`validate`; failing records are deleted.
- **Persistence never writes before the restore attempt finished**, and edits made while loading win over the stored draft.
- **`clearAll` ordering**: unmount forms first (their `dispose()` flushes a save), then `clearAll()`. The example's `App.tsx` uses `flushSync` for this (storage lives in `examples/react-vite/src/drafts.ts`); `examples/react-vite/src/App.test.tsx` fails if the ordering is lost.
- **Revision keys**: a `RevisionKey` is stored as the array key `[scope, document, revision]` in the same object store as string keys (strings sort before arrays); no `DB_VERSION` bump. `listRevisions`/`removeRevisions` are part of `FormHistoryStorage` and the `storage.test.ts` contract suite; every adapter needs them.
- **Recovery base**: `base` is captured (`structuredClone`) before the restore attempt and written unchanged on every save (an exact restore adopts the record's own). Candidate detection finishes before `ready`, so no save precedes it. `clear()` on a revision key removes all revisions.
- **Versions**: bump `DRAFT_VERSION` in `examples/react-vite/src/form/ProfileForm.tsx` when the demo form shape changes (old drafts are discarded). Bump `DB_VERSION` in `packages/rhf-history-persist/src/indexedDbStorage.ts` for IndexedDB schema changes (v3 added the `meta` store) and keep `onupgradeneeded` idempotent so any older version upgrades in place.
- **Public API**: `rhf-history/src/{index,core}.ts` and `rhf-history-persist/src/{index,indexeddb}.ts` are the contract. Run `pnpm -r check:pkg` (publint + attw) after touching exports, and update the affected package README's API reference.
- RHF clones the entire form on every change once any `values` subscriber exists (inherent to its public API; measured ~0.04 ms at 300 fields, ~3.7 ms at 30k). Avoiding it would require RHF internals (`control._subjects`) — deliberately not done.

## Testing conventions

- Test names follow `should X when Y`. jsdom env, setup in each package's `test/setup.ts` (jest-dom matchers + cleanup).
- IndexedDB tests inject `new IDBFactory()` from `fake-indexeddb` per test via `createIndexedDbStorage({ indexedDB })` for isolation; only the example's `App.test.tsx` uses `fake-indexeddb/auto` (`drafts.ts` creates the app storage at module level).
- Headless store tests use `createFormControl` + manual `register` + `createFormHistoryStore(formControl).connect()` (see `scale.test.tsx`).
- `packages/rhf-history-persist/src/storage.test.ts` is a `describe.each` contract suite run against every storage adapter — add new adapters there.

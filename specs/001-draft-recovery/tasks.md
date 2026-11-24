# Tasks: Draft recovery onto a newer revision

> **Spec:** [spec.md](./spec.md) — **Plan:** [plan.md](./plan.md)
> **Status:** In progress (browser check of 011 outstanding)
> **Last updated:** 2026-11-20

Each task: status marker, imperative title, files touched, acceptance criteria satisfied, definition of done. Tasks are small enough for one focused coding-agent session.

Paths are relative to `packages/rhf-history/` unless they start with `examples/`. "Gates" means `pnpm lint && pnpm typecheck && pnpm test:run` all pass. Tasks 001 and 002–003 don't depend on each other and can run in parallel.

---

## [DONE] 001 — Add pure three-way merge to /core

- **Files:** `src/merge.ts` (new), `src/merge.test.ts` (new), `src/core.ts`
- **Satisfies:** AC-10, AC-11, AC-12, AC-13, AC-14, AC-15
- **Depends on:** none
- **Definition of done:**
  - `merge3`, `Conflict`, `Resolutions` and `MergeResult` match the plan's signatures, and `/core` exports them.
  - Tests cover:
    - a clean apply;
    - the same path changed on both sides to different values (conflict) and to equal values (no conflict);
    - an ancestor/descendant overlap reported at the outermost path;
    - a length-changed array treated as one path;
    - the "mine" resolution;
    - unresolved conflicts keeping "theirs";
    - no mutation of the inputs;
    - `__proto__` paths refused.
  - Gates pass.

---

## [DONE] 002 — Accept structured RevisionKey in every storage adapter

- **Files:** `src/persistence/storage.ts`, `src/persistence/indexedDbStorage.ts`, `src/persistence/storage.test.ts`, `src/persistence/indexedDbStorage.test.ts`
- **Satisfies:** AC-4 (key isolation), AC-8 (string keys unchanged)
- **Depends on:** none
- **Definition of done:**
  - `DraftKey`/`RevisionKey` exist, and `load`/`save`/`remove` accept both kinds of key.
  - IndexedDB stores a revision key as `[scope, document, revision]`; memory encodes keys with `JSON.stringify`.
  - The contract suite proves that a string key and a revision key never collide, and that revisions containing `-`, `"`, `/` round-trip.
  - The clear epoch, `clearAll` and `removeOlderThan` still pass for revision keys.
  - Gates pass.

---

## [DONE] 003 — Add listRevisions and removeRevisions to the storage contract

- **Files:** `src/persistence/storage.ts`, `src/persistence/indexedDbStorage.ts`, `src/persistence/storage.test.ts`
- **Satisfies:** AC-4, AC-24
- **Depends on:** 002
- **Definition of done:**
  - Both operations are implemented for memory, null and IndexedDB, as in the plan.
  - The contract suite covers:
    - `asset-4` vs `asset-42`;
    - other scopes excluded;
    - `keep` preserved;
    - string keys untouched;
    - call order (a `listRevisions` right after an unresolved `save` sees it).
  - Gates pass.

---

## [DONE] 004 — Persist base values and clear all revisions for RevisionKey drafts

- **Files:** `src/persistence/storage.ts` (`base?`), `src/persistence/isPersistedRecord.ts`, `src/persistence/isPersistedRecord.test.ts`, `src/persistence/persistFormHistory.ts`, `src/persistence/persistFormHistory.test.ts`
- **Satisfies:** AC-1, AC-7, AC-8, AC-22
- **Depends on:** 003
- **Definition of done:**
  - Base values are captured before the restore; an exact restore adopts `record.base`, and every save writes the same base.
  - String-key records have no `base`, and a `base` that isn't an object fails the structural check.
  - `clear()` with a revision key removes every revision of the document.
  - Gates pass.

---

## [DONE] 005 — Detect a recovery candidate after the exact lookup misses

- **Files:** `src/persistence/persistFormHistory.ts`, `src/persistence/persistFormHistory.test.ts`
- **Satisfies:** AC-2, AC-3, AC-4, AC-5, AC-6
- **Depends on:** 004
- **Definition of done:**
  - `candidate` resolves with the newest usable stale draft, or `null`.
  - Unusable drafts are deleted and skipped: expired, wrong `version`, failing the structural check, or without `base`.
  - Edits made during detection don't suppress the candidate.
  - A storage error goes to `onError` and resolves `null`, and the exact restore is unaffected.
  - No write happens before detection finishes.
  - String keys always resolve `null`.
  - Gates pass.

---

## [DONE] 006 — Implement preview, accept and discard on the candidate

- **Files:** `src/persistence/persistFormHistory.ts`, `src/persistence/persistFormHistory.test.ts`, `src/persistence/storage.ts` (`RecoveryUnavailableError`)
- **Satisfies:** AC-9, AC-10–AC-15 (through `merge3`), AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-23
- **Depends on:** 001, 005
- **Definition of done:**
  - `preview` changes nothing and reports `valid`.
  - `accept`:
    - leaves exactly one undo entry, and a single undo returns the form to the target values;
    - saves `(D, R)` with `base`;
    - deletes the stale revisions.
  - `discard` deletes the stale revisions and leaves the form untouched.
  - Disposing without a decision keeps the stale drafts.
  - `accept` after another instance has settled the candidate rejects with `RecoveryUnavailableError`, using two persistence instances on one storage.
  - After another context's `clearAll`, `accept` rejects with `DraftsClearedError` and creates no record.
  - Gates pass.

---

## [DONE] 007 — Expose recovery from usePersistedFormHistory

- **Files:** `src/persistence/usePersistedFormHistory.ts`, `src/persistence/reload.test.tsx` (or a new `recovery.test.tsx`), `test/fixtures/` (a revision-aware fixture if needed)
- **Satisfies:** AC-2, AC-17, AC-20
- **Depends on:** 006
- **Definition of done:**
  - The hook returns `recovery`, which resets to `null` after accept or discard.
  - The effect is keyed by a stable key id: a new `{ scope, document, revision }` object with the same content doesn't re-initialise.
  - `src/scale.test.tsx` still passes; there is no extra field-list render.
  - Gates pass.

---

## [DONE] 008 — Benchmark base-value saves at 30k fields

- **Files:** `src/formHistoryStore.bench.ts` (or a new `src/persistence/persistFormHistory.bench.ts`)
- **Satisfies:** spec edge case "very large form"; plan trade-off "full base per draft"
- **Depends on:** 004
- **Definition of done:**
  - A bench compares the save cost with and without `base` at 3k and 30k fields.
  - The result is recorded in plan.md's Trade-offs.
  - If a save exceeds 10 ms at 30k fields, a follow-up question is added to plan.md's Open questions instead of being decided silently.

---

## [DONE] 009 — Export the API and document recovery

- **Files:** `src/index.ts`, `README.md`, `.changeset/draft-recovery.md` (new, minor), `CLAUDE.md` (root)
- **Satisfies:** AC-1–AC-24 (public contract)
- **Depends on:** 007
- **Definition of done:**
  - The exports match the plan's Exports section.
  - The README has a "Recovering drafts across revisions" section and updated API tables, including the new storage operations for custom adapters.
  - `CLAUDE.md` lists the revision-key and base invariants.
  - `pnpm -F @yoo-digital/rhf-history check:pkg` and the gates pass.

---

## [DONE] 010 — Add a fake server revision to the demo profile form

- **Files:** `examples/react-vite/src/form/fakeServer.ts` (new), `examples/react-vite/src/form/ProfileForm.tsx`, `examples/react-vite/src/App.tsx`
- **Satisfies:** AC-22, AC-25
- **Depends on:** 009
- **Definition of done:**
  - "Simulate new server revision" changes one field and bumps the revision, and the form remounts at the new revision using a revision key.
  - Submit writes to the fake server, bumps the revision and clears the drafts.
  - `DRAFT_VERSION` is bumped.
  - The existing `App.test.tsx` clear-ordering test still passes.

---

## [IN_PROGRESS] 011 — Build the demo recovery dialog

- **Files:** `examples/react-vite/src/components/RecoveryDialog.tsx` (new), `examples/react-vite/src/components/ui/dialog.tsx` (shadcn, if missing), `examples/react-vite/src/form/ProfileForm.tsx`
- **Satisfies:** AC-26
- **Depends on:** 010
- **Definition of done:**
  - The dialog lists the applied changes and the conflicts, with a "keep mine"/"keep server" choice per conflict that updates the preview.
  - "Recover" and "Discard" call `accept`/`discard`, and the dialog closes.
  - The dialog is a leaf component, so the form doesn't re-render.
  - Checked in the browser (`pnpm dev`) in light and dark mode.

---

## [DONE] 012 — Test the demo recovery flow end to end

- **Files:** `examples/react-vite/src/App.test.tsx` (or a new `examples/react-vite/src/recovery.test.tsx`)
- **Satisfies:** AC-25, AC-26
- **Depends on:** 011
- **Definition of done:**
  - A test edits a field, simulates a new revision, and checks that the dialog appears with the expected change or conflict.
  - Taking "Recover" then a single undo returns the form to the server values.
  - Taking "Discard" leaves the server values and shows no dialog after a remount.
  - Gates pass.

---

## Traceability matrix

| AC    | Covered by tasks |
| ----- | ---------------- |
| AC-1  | 004              |
| AC-2  | 005, 007         |
| AC-3  | 005              |
| AC-4  | 002, 003, 005    |
| AC-5  | 005              |
| AC-6  | 005              |
| AC-7  | 004              |
| AC-8  | 002, 004         |
| AC-9  | 006              |
| AC-10 | 001, 006         |
| AC-11 | 001, 006         |
| AC-12 | 001, 006         |
| AC-13 | 001, 006         |
| AC-14 | 001, 006         |
| AC-15 | 001, 006         |
| AC-16 | 006              |
| AC-17 | 006, 007         |
| AC-18 | 006, 012         |
| AC-19 | 006              |
| AC-20 | 006, 007         |
| AC-21 | 006              |
| AC-22 | 004, 010         |
| AC-23 | 006              |
| AC-24 | 003, 009         |
| AC-25 | 010, 012         |
| AC-26 | 011, 012         |

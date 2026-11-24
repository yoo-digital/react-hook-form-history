# Spec: Draft recovery onto a newer revision

> **Status:** Approved
> **Owner:** Tobias Maier
> **Created:** 2026-11-20
> **Last updated:** 2026-11-20
> **Supersedes:** none

## Goal

Some host apps edit server documents that carry a revision, for example an asset with an etag. When the user returns to such a document after it has changed on the server, the user's unsaved draft for the old revision must not be lost silently. `@yoo-digital/rhf-history` lets the host app offer to recover those changes onto the current revision, shows which fields conflict, and lets the user undo the whole recovery in one step.

## Terms

| Term              | Meaning                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Document**      | One editable server entity, identified by a document id (e.g. `asset-42`).                                             |
| **Revision**      | An opaque server version tag of a document (e.g. an etag such as `W/"a1-b2"`). The library never interprets it.        |
| **Draft**         | A persisted record for one (user, document, revision): base values, current values, undo/redo history.                 |
| **Base values**   | The document's values at the draft's revision, as the host app loaded them before the first edit.                      |
| **Stale draft**   | A draft for the same document as the open form but a different revision.                                               |
| **Target values** | The form's values at the moment the user accepts a recovery (the current revision, plus any edits made since opening). |
| **Own changes**   | The leaf-level differences between a stale draft's base values and its current values.                                 |
| **Conflict**      | A path where the stale draft and the target values both differ from the base values, and differ from each other.       |

## User stories

- As an **editor**, I want to be told when I have unsaved changes to an older version of the asset I just opened, so that I don't lose work because someone else saved in the meantime.
- As an **editor**, I want to see which of my changes clash with the newer version and decide per field, so that I don't overwrite a colleague's change by accident.
- As an **editor**, I want to undo a recovery in one step, so that I can get back to the current server version if the result is wrong.
- As a **host-app developer**, I want the library to find, merge and clean up drafts across revisions, while I own the dialog and the revision format, so that I don't reimplement merge logic per form.
- As a **host-app developer** not using revisions, I want persistence to behave exactly as today, so that upgrading costs nothing.

## Acceptance criteria

EARS syntax. "The persistence" means the library's draft persistence for one mounted form. "The host app" means the code using the library.

**Finding drafts**

- **AC-1.** WHEN a form starts persistence for (document D, revision R) and a draft for exactly (D, R) exists, the persistence SHALL restore that draft as it does today (values, history, expiry, version and structural checks unchanged).
- **AC-2.** WHEN a form starts persistence for (D, R), no draft for (D, R) exists, and at least one stale draft for D exists, the persistence SHALL NOT change the form and SHALL report a recovery candidate to the host app.
- **AC-3.** WHEN more than one stale draft for D exists, the persistence SHALL report the one with the newest `savedAt` as the candidate.
- **AC-4.** The persistence SHALL NOT report drafts of a different document as candidates, even when that document's id starts with the same characters as D's (e.g. `asset-42` while D is `asset-4`), nor drafts belonging to a different user scope.
- **AC-5.** IF a stale draft is expired, has a different form `version`, fails the structural check, or has no base values, THEN the persistence SHALL delete that draft and SHALL NOT report it as a candidate.
- **AC-6.** WHEN the user edits the form before candidate detection has finished, the persistence SHALL still report the candidate (unlike AC-1, where edits during load win), because recovering does not overwrite those edits without the user's confirmation.

**Saving base values**

- **AC-7.** WHEN the persistence saves a draft for (D, R), the draft SHALL contain the base values the form was opened with for revision R, and SHALL keep those base values unchanged across later saves of the same (D, R).
- **AC-8.** WHEN the host app does not supply a revision, the persistence SHALL NOT store base values and SHALL produce records readable by the previous library version.

**Previewing a recovery**

- **AC-9.** WHEN the host app requests a preview for a candidate, the library SHALL return the merged values, the list of applied own changes, and the list of conflicts, and SHALL NOT modify the form, its history, or storage.
- **AC-10.** WHEN an own change at path P is not a conflict, the merged values SHALL contain the stale draft's value at P.
- **AC-11.** WHEN an own change at path P overlaps a change between base and target values at path Q (Q equals P, or one is an ancestor of the other), the library SHALL group them and compare the stale draft's and the target's values at the outermost path of the group (the shorter of P and Q). IF those values differ, THEN the library SHALL report one conflict at that outermost path with its base, stale-draft and target values.
- **AC-12.** IF the stale draft and the target values hold equal values at P, THEN the library SHALL NOT report a conflict at P.
- **AC-13.** WHEN the length of an array differs between base, stale draft or target values, the library SHALL treat that whole array as one path for change and conflict detection.
- **AC-14.** WHILE a conflict at P is unresolved, the merged values SHALL contain the target value at P.
- **AC-15.** WHEN the host app resolves a conflict at P as "keep mine", a subsequent preview or accept SHALL use the stale draft's value at P.
- **AC-16.** WHEN the host app passed a `validate` function, the preview SHALL report whether the merged values pass it.

**Accepting or discarding**

- **AC-17.** WHEN the host app accepts a candidate, the library SHALL set the merged values on the form, replace the undo/redo history with exactly one undo entry from the target values to the merged values, and record no other step.
- **AC-18.** WHEN the user undoes once after an accepted recovery, the form values SHALL equal the target values.
- **AC-19.** WHEN the host app accepts a candidate, the persistence SHALL save the form as a draft for (D, R) with the base values of revision R, and SHALL delete every stale draft of D.
- **AC-20.** WHEN the host app discards a candidate, the persistence SHALL delete every stale draft of D and SHALL NOT change the form.
- **AC-21.** IF the host app neither accepts nor discards a candidate before the form is disposed, THEN the persistence SHALL keep the stale drafts (subject to expiry).

**Lifecycle**

- **AC-22.** WHEN the host app calls `clear` for (D, R), for example after a successful submit, the persistence SHALL delete the drafts of D for every revision, so a later open at the new revision reports no candidate.
- **AC-23.** WHEN another context has called `clearAll`, the persistence SHALL NOT recreate a draft through recovery (same `DraftsClearedError` behaviour as saving).
- **AC-24.** Every storage adapter shipped with the library SHALL support listing the drafts of one document, and the shared storage contract suite SHALL cover it, including the prefix case of AC-4.

**Demo (example app)**

- **AC-25.** WHEN the demo user presses "Simulate new server revision" on the profile form, the example app SHALL change at least one field value and the revision, and SHALL remount the form at that revision.
- **AC-26.** WHEN the remounted demo form has a recovery candidate, the example app SHALL show a dialog listing applied changes and conflicts, let the user choose "keep mine" or "keep server" per conflict, and offer "Recover" and "Discard".

## Non-goals

- **Fetching old revisions from a server.** The base values come from the draft only; the library never calls the host app's API.
- **A conflict dialog or any UI in the library.** The library ships no UI. The demo dialog lives only in the example app (AC-25, AC-26).
- **Text-level merging inside one field.** A field is one value; if both sides changed it, it is a conflict.
- **Matching array items by identity.** Arrays are merged as a whole when their length differs (AC-13); identity-based row matching is deferred to a later spec.
- **Recovering across form `version` changes.** A stale draft with a different `version` is discarded (AC-5), not migrated.
- **Automatic recovery without user confirmation.** A candidate is never applied unless the host app accepts it.
- **Replacing server-side concurrency control.** The host app still sends its revision (e.g. `If-Match`) on save.

## Edge cases

- **Empty / missing input:** no revision supplied → today's behaviour (AC-8). A stale draft with an empty history but changed values cannot exist, because an empty history deletes the draft today.
- **Invalid input:** a corrupt or tampered stale draft, or one missing base values (written before this feature), is deleted, not offered (AC-5). Revisions are compared as opaque strings; characters such as `-`, `"`, `/` in a revision must not break lookup.
- **Concurrent access:**
  - Two tabs open the same document at the new revision. Both may report the same candidate; the first accept or discard deletes the stale drafts, and the second tab's accept must fail with an error the host app can show, not recreate them.
  - The user keeps editing while the candidate is pending (AC-6). Edits are recorded and saved under (D, R) as usual; an accept merges onto the edited values (target values).
- **Network or dependency failure:** a storage failure while listing candidates reports no candidate and calls `onError`; it must not block the exact-draft restore of AC-1.
- **Permission / authorization edges:** drafts are per user scope (part of the key). Candidates from another user scope are never reported (AC-4). Logout `clearAll` removes candidates too.
- **Other:**
  - The current revision R is older than the stale draft's revision (e.g. the server rolled back). The draft is still a stale draft; the same rules apply.
  - The stale draft's own changes are all equal to the target values. The preview has no applied changes and no conflicts; accepting adds no undo entry and only deletes the stale drafts.
  - A very large form: base values roughly double the stored record size.

## Dependencies

- **Other specs:** none.
- **Existing behaviour relied on:** draft persistence (`persistFormHistory`), the cross-tab clear epoch and `DraftsClearedError`, the structural record check (`isPersistedRecord`), and `diff` in `/core`.
- **Steering rules invoked** (from `CLAUDE.md`; there is no `specs/_steering/` yet):
  - **Storage operations take effect in call order**, which includes the new lookup.
  - **Persistence never writes before the restore attempt has finished.**
  - **No form-level re-renders**, including while a candidate is pending.
  - **IndexedDB schema changes bump `DB_VERSION`** and upgrade in place.
  - **Public API changes update the README and pass `check:pkg`.**

## Open questions

- **Storage cost on very large forms:** is doubling the record size for 30k-field forms acceptable, or should the base be stored as a diff against the values? To be settled in plan.md.

**Resolved (2026-11-20):**

- **Key shape:** structured key (scope, document, revision), stored as an IndexedDB array key. Lookup by document is exact, and revisions may contain any characters. Plain string keys keep working unchanged.
- **Conflict default (AC-14):** keep the target (server) value until the user picks "keep mine".
- **Discard (AC-20):** delete the stale drafts immediately.
- **Several stale revisions (AC-3):** offer only the newest.
- **Arrays:** no identity matching in v1 (it stays a non-goal). A follow-up spec covers it if whole-array conflicts turn out to be common.

import type { Entry } from '@yoo-digital/rhf-history';
import type { PersistedFormHistory } from '@yoo-digital/rhf-history-persist';
import { useEffect, useState, type JSX } from 'react';
import { draftStorage, onDraftsChanged, profileDraftKey } from '@/drafts';

type Props = {
  /** Server revision the profile form is editing. */
  revision: string;
};

type Stored =
  | { status: 'loading' | 'empty' | 'unreadable' }
  | { status: 'saved'; record: PersistedFormHistory };

// Raw IndexedDB content is untrusted: check the parts this panel renders.
const isRenderable = (record: PersistedFormHistory): boolean =>
  Number.isFinite(record.savedAt) &&
  Array.isArray(record.history?.past) &&
  record.history.past.every((entry) => Array.isArray(entry?.patches));

const show = (value: unknown): string => (value === undefined ? '(none)' : JSON.stringify(value));

/**
 * Shows the record IndexedDB currently holds for the profile draft: the values and
 * every undo entry as `path: before → after` patches. Nested booleans and array
 * moves are persisted like any other field, by their dot path.
 */
export function DraftInspector({ revision }: Props): JSX.Element {
  const stored = useStoredDraft(revision);

  const record = stored.status === 'saved' ? stored.record : undefined;
  const entries = record?.history.past ?? [];
  const summary = {
    loading: 'loading…',
    empty: 'nothing saved yet',
    unreadable: 'could not read the stored record',
    saved:
      record &&
      `saved ${new Date(record.savedAt).toLocaleTimeString()}, ${entries.length} undo entries`,
  }[stored.status];

  return (
    <details
      className="border bg-card text-xs"
      data-testid="stored-draft"
    >
      <summary className="cursor-pointer px-4 py-3 font-medium">
        Stored draft{' '}
        <span
          className="font-normal text-muted-foreground"
          data-testid="stored-draft-status"
        >
          {summary}
        </span>
      </summary>
      {record && (
        <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium">Undo entries (newest first)</h3>
            {entries.length === 0 ? (
              <p className="text-muted-foreground">No edits yet.</p>
            ) : (
              <UndoEntries entries={entries} />
            )}
          </section>
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium">Values</h3>
            <pre className="overflow-x-auto bg-muted p-3">
              {JSON.stringify(record.values, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </details>
  );
}

/** The stored profile draft for `revision`, re-read after every storage change. */
function useStoredDraft(revision: string): Stored {
  const [stored, setStored] = useState<Stored>({ status: 'loading' });

  useEffect(() => {
    const draftKey = profileDraftKey(revision);
    let latest = 0;
    // Re-reads after every change. Only the newest read may update the panel, so a
    // slow earlier read can't overwrite a later one.
    const refresh = (): void => {
      const request = ++latest;
      draftStorage.load(draftKey).then(
        (record) => {
          if (request !== latest) return;
          if (!record) setStored({ status: 'empty' });
          else if (isRenderable(record)) setStored({ status: 'saved', record });
          else setStored({ status: 'unreadable' });
        },
        () => request === latest && setStored({ status: 'unreadable' }),
      );
    };
    refresh();
    const stop = onDraftsChanged(refresh);
    return (): void => {
      latest = -1;
      stop();
    };
  }, [revision]);

  return stored;
}

function UndoEntries({ entries }: { entries: Entry[] }): JSX.Element {
  // Keyed by 1-based position in `past`: editing and undoing only add or remove entries at the end.
  const newestFirst = entries.map((entry, i) => ({ entry, step: i + 1 })).toReversed();
  return (
    <ol className="flex flex-col gap-2">
      {newestFirst.map(({ entry, step }) => (
        <li
          key={step}
          className="flex flex-col gap-0.5 border-l-2 border-signal pl-2"
        >
          {entry.patches.map((patch) => (
            <span
              key={patch.path}
              className="break-all font-mono"
            >
              <span className="text-muted-foreground">{patch.path}</span> {show(patch.before)} →{' '}
              {show(patch.after)}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

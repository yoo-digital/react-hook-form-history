import { useFormHistoryState, type FormHistoryStore } from '@yoo-digital/rhf-history';
import type { JSX } from 'react';
import { useFormState, type Control, type FieldValues } from 'react-hook-form';

type Props<T extends FieldValues> = {
  history: FormHistoryStore;
  control: Control<T>;
};

/**
 * Isolated so that history and dirty-state updates re-render only the toolbar,
 * never the (potentially huge) form around it.
 */
export function HistoryToolbar<T extends FieldValues>({ history, control }: Props<T>): JSX.Element {
  const { canUndo, canRedo, undoCount, redoCount } = useFormHistoryState(history);
  const { isDirty } = useFormState({ control });

  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="History"
    >
      <button
        type="button"
        onClick={history.undo}
        disabled={!canUndo}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!canRedo}
      >
        Redo
      </button>
      <span
        className="status"
        aria-live="polite"
      >
        {undoCount} undo · {redoCount} redo
        {isDirty ? ' · unsaved changes' : ''}
      </span>
    </div>
  );
}

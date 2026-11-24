import { get, set, type FieldPath, type FieldValues, type UseFormReturn } from 'react-hook-form';
import * as H from './history';

export type FormHistoryOptions = {
  /** Maximum number of undo steps. */
  limit?: number;
  /** Consecutive edits of the same field within this window become one undo step. */
  mergeWindowMs?: number;
};

export type FormHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
};

export type FormHistoryStore = {
  undo: () => void;
  redo: () => void;
  /** Closes the current edit group, e.g. on blur, so the next edit is its own undo step. */
  checkpoint: () => void;
  /** Drops all history and uses the current form values as the new baseline. */
  clear: () => void;
  getHistory: () => H.History;
  getState: () => FormHistoryState;
  /** For `useSyncExternalStore`: notified whenever `getState()` changes. */
  subscribe: (listener: () => void) => () => void;
  /** Notified on every recorded change, including ones coalesced into the last entry. */
  subscribeChanges: (listener: () => void) => () => void;
  /** Replaces form values and history, e.g. with a persisted session. Not recorded as a step. */
  restore: (snapshot: { values: FieldValues; history: H.History }) => void;
  /** Starts recording form changes. Returns a function that stops it. */
  connect: () => () => void;
  setOptions: (options: FormHistoryOptions) => void;
};

type Form<T extends FieldValues> = Pick<
  UseFormReturn<T>,
  'subscribe' | 'getValues' | 'setValue' | 'trigger' | 'reset'
>;

/**
 * Undo/redo for a react-hook-form instance, kept outside of React state so that
 * recording a change never re-renders the form.
 *
 * Scales with the size of an edit rather than the size of the form:
 * - a field change compares and clones only that field's value (from `subscribe`'s `name`),
 * - undo/redo writes back only the changed paths via `setValue`,
 * - only changes without a field name (e.g. an external `reset()`) diff the whole form.
 */
export function createFormHistoryStore<T extends FieldValues>(
  form: Form<T>,
  initialOptions: FormHistoryOptions = {},
): FormHistoryStore {
  let options = initialOptions;
  let history = H.createHistory();
  let state = toState(history);
  const shadow = createShadow(form.getValues());
  let isApplying = false;
  let isSubmitted = false;
  const listeners = createListeners();
  const changeListeners = createListeners();

  const commit = (next: H.History): void => {
    if (next === history) return;
    history = next;
    changeListeners.notify();
    const nextState = toState(history);
    if (shallowEqual(state, nextState)) return;
    state = nextState;
    listeners.notify();
  };

  const recordChange = (values: FieldValues, name: string | undefined): void => {
    const patches = shadow.update(values, name);
    if (patches.length === 0) return;
    commit(
      H.record(history, patches, {
        group: name ?? null,
        limit: options.limit,
        mergeWindowMs: options.mergeWindowMs,
      }),
    );
  };

  const apply = ({ history: next, changes }: { history: H.History; changes: H.Change[] }): void => {
    if (changes.length === 0) return;
    commit(next);
    isApplying = true;
    try {
      for (const { path, value } of changes) {
        shadow.set(path, value);
        form.setValue(path as FieldPath<T>, structuredClone(value) as never, {
          shouldDirty: true,
        });
      }
    } finally {
      isApplying = false;
    }
    // Once the user has submitted, show errors for the restored fields only.
    if (isSubmitted) void form.trigger(changes.map((change) => change.path) as FieldPath<T>[]);
  };

  return {
    undo: () => apply(H.undo(history)),
    redo: () => apply(H.redo(history)),
    checkpoint: () => commit(H.seal(history)),
    clear: () => {
      shadow.reset(form.getValues());
      commit(H.createHistory());
    },
    getHistory: () => history,
    getState: () => state,
    subscribe: listeners.add,
    subscribeChanges: changeListeners.add,
    restore: ({ values, history: next }) => {
      isApplying = true;
      try {
        form.reset(structuredClone(values) as T, { keepDefaultValues: true });
      } finally {
        isApplying = false;
      }
      shadow.reset(values);
      commit(next);
    },
    connect: () => {
      // The form may have changed while disconnected (e.g. StrictMode re-mount).
      shadow.reset(form.getValues());
      return subscribeToForm(form, {
        onValues: (values, name) => {
          if (!isApplying) recordChange(values, name);
        },
        onSubmitted: (submitted) => {
          isSubmitted = submitted ?? isSubmitted;
        },
      });
    },
    setOptions: (next) => {
      options = next;
    },
  };
}

type Shadow = {
  /** Patches from the shadow to `values` (only `name`'s subtree when given); updates the shadow. */
  update: (values: FieldValues, name: string | undefined) => H.Patch[];
  set: (path: string, value: unknown) => void;
  reset: (values: FieldValues) => void;
};

/** Private mutable copy of the last known form values, used to compute `before` of each patch. */
function createShadow(initial: FieldValues): Shadow {
  let shadow: FieldValues = structuredClone(initial);
  return {
    update: (values, name) => {
      if (!name) {
        const patches = H.diff(shadow, values);
        if (patches.length > 0) shadow = structuredClone(values);
        return patches;
      }
      const before = get(shadow, name);
      const after = get(values, name);
      if (H.deepEqual(before, after)) return [];
      // Separate clones: the shadow is mutated later on, patches must stay immutable.
      set(shadow, name, structuredClone(after));
      return [{ path: name, before, after: structuredClone(after) }];
    },
    set: (path, value) => set(shadow, path, structuredClone(value)),
    reset: (values) => {
      shadow = structuredClone(values);
    },
  };
}

type Listeners = { add: (listener: () => void) => () => void; notify: () => void };

function createListeners(): Listeners {
  const listeners = new Set<() => void>();
  return {
    add: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => listeners.forEach((listener) => listener()),
  };
}

function subscribeToForm<T extends FieldValues>(
  form: Form<T>,
  handlers: {
    onValues: (values: FieldValues, name: string | undefined) => void;
    onSubmitted: (isSubmitted: boolean | undefined) => void;
  },
): () => void {
  const stopValues = form.subscribe({
    formState: { values: true },
    callback: ({ values, name }) => handlers.onValues(values, name),
  });
  const stopSubmitted = form.subscribe({
    formState: { isSubmitted: true },
    callback: (formState) => handlers.onSubmitted(formState.isSubmitted),
  });
  return () => {
    stopValues();
    stopSubmitted();
  };
}

function toState(history: H.History): FormHistoryState {
  return {
    canUndo: H.canUndo(history),
    canRedo: H.canRedo(history),
    undoCount: history.past.length,
    redoCount: history.future.length,
  };
}

function shallowEqual(a: FormHistoryState, b: FormHistoryState): boolean {
  return (
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.undoCount === b.undoCount &&
    a.redoCount === b.redoCount
  );
}

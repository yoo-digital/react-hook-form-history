import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import {
  createFormHistoryStore,
  type FormHistoryOptions,
  type FormHistoryState,
  type FormHistoryStore,
} from './formHistoryStore';

/**
 * Creates a stable undo/redo store for `form` and records its changes.
 *
 * Calling this does not re-render the component when history changes. Read
 * `canUndo`/`canRedo` etc. with `useFormHistoryState(store)` in a small child
 * component, so that a form with thousands of fields isn't re-rendered per keystroke.
 */
export function useFormHistory<T extends FieldValues>(
  form: UseFormReturn<T>,
  { limit, mergeWindowMs }: FormHistoryOptions = {},
): FormHistoryStore {
  const [store] = useState(() => createFormHistoryStore(form, { limit, mergeWindowMs }));

  useEffect(() => store.setOptions({ limit, mergeWindowMs }), [store, limit, mergeWindowMs]);
  useEffect(() => store.connect(), [store]);

  return store;
}

/** Subscribes to the history's `canUndo`/`canRedo`/counts. */
export function useFormHistoryState(store: FormHistoryStore): FormHistoryState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

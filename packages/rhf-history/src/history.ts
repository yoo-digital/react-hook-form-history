/**
 * Framework-agnostic, immutable undo/redo history of *patches*.
 *
 * Each entry stores only the paths that changed (with their before/after values),
 * so memory and per-change cost scale with the size of the edit, not the size of
 * the form. The structure is plain JSON (as long as the values are), so it can be
 * persisted to storage and restored later without conversion.
 */

/** A change of one value at a dot-separated path (react-hook-form field name syntax). */
export type Patch = { path: string; before: unknown; after: unknown };

/** A value to write back to the form at `path`. */
export type Change = { path: string; value: unknown };

export type Entry = { patches: Patch[] };

export type History = {
  past: Entry[];
  future: Entry[];
  /** Group of the last recorded entry; consecutive changes of the same group are coalesced. */
  group: string | null;
  /** Timestamp (ms) of the last recorded change. */
  updatedAt: number;
};

export type RecordOptions = {
  /** Changes with the same group inside `mergeWindowMs` are merged into the last entry. */
  group?: string | null;
  now?: number;
  mergeWindowMs?: number;
  /** Maximum number of entries kept in `past`. Oldest entries are dropped first. */
  limit?: number;
  isEqual?: (a: unknown, b: unknown) => boolean;
};

export const DEFAULT_LIMIT = 100;
export const DEFAULT_MERGE_WINDOW_MS = 500;

export function createHistory(): History {
  return { past: [], future: [], group: null, updatedAt: 0 };
}

export function record(
  history: History,
  patches: Patch[],
  {
    group = null,
    now = Date.now(),
    mergeWindowMs = DEFAULT_MERGE_WINDOW_MS,
    limit = DEFAULT_LIMIT,
    isEqual = deepEqual,
  }: RecordOptions = {},
): History {
  const changed = patches.filter((patch) => !isEqual(patch.before, patch.after));
  if (changed.length === 0) return history;

  const last = history.past.at(-1);
  const coalesce =
    last !== undefined &&
    group !== null &&
    group === history.group &&
    now - history.updatedAt <= mergeWindowMs;

  if (coalesce) {
    const merged = mergePatches(last.patches, changed, isEqual);
    // The group edited its value back to where it started: the entry is a no-op.
    const past = merged.length
      ? [...history.past.slice(0, -1), { patches: merged }]
      : history.past.slice(0, -1);
    return { past, future: [], group: merged.length ? group : null, updatedAt: now };
  }

  const past = [...history.past, { patches: changed }];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
    group,
    updatedAt: now,
  };
}

/** Pops the last entry. `changes` must be written to the form in order. */
export function undo(history: History): { history: History; changes: Change[] } {
  const entry = history.past.at(-1);
  if (!entry) return { history, changes: [] };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [entry, ...history.future],
      group: null,
      updatedAt: 0,
    },
    changes: entry.patches.toReversed().map(({ path, before }) => ({ path, value: before })),
  };
}

/** Re-applies the next entry. `changes` must be written to the form in order. */
export function redo(history: History): { history: History; changes: Change[] } {
  const [entry, ...future] = history.future;
  if (!entry) return { history, changes: [] };
  return {
    history: {
      past: [...history.past, entry],
      future,
      group: null,
      updatedAt: 0,
    },
    changes: entry.patches.map(({ path, after }) => ({ path, value: after })),
  };
}

/** Ends the current coalescing group so the next change starts a new entry. */
export function seal(history: History): History {
  return history.group === null ? history : { ...history, group: null };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

function mergePatches(
  existing: Patch[],
  incoming: Patch[],
  isEqual: (a: unknown, b: unknown) => boolean,
): Patch[] {
  const merged = [...existing];
  for (const patch of incoming) {
    const index = merged.findIndex((p) => p.path === patch.path);
    if (index === -1) merged.push(patch);
    else merged[index] = { ...merged[index], after: patch.after };
  }
  return merged.filter((patch) => !isEqual(patch.before, patch.after));
}

/**
 * Lists the leaf-level differences between two values as patches.
 * Arrays of different length are reported as a single patch of the whole array.
 */
export function diff(before: unknown, after: unknown, path = ''): Patch[] {
  if (deepEqual(before, after)) return [];
  if (
    isContainer(before) &&
    isContainer(after) &&
    Array.isArray(before) === Array.isArray(after) &&
    (!Array.isArray(before) || before.length === (after as unknown[]).length)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) =>
      diff(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return [{ path, before, after }];
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !(value instanceof Date);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

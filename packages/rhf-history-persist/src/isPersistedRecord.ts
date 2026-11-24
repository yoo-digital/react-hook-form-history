import type { PersistedFormHistory } from './storage';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Mirrors both ways react-hook-form has parsed paths: older versions strip `"`, `'`, `|` and `]`
// before splitting on `.`/`[` (so `__pro"to__` becomes `__proto__`), newer ones split on all of them.
const toSegments = (path: string): string[] => [
  ...path.replace(/["'|\]]/g, '').split(/[.[]/),
  ...path.split(/[.[\]'"|]/),
];

const isSafePath = (path: unknown): boolean =>
  typeof path === 'string' &&
  path !== '' &&
  !toSegments(path).some((segment) => FORBIDDEN_SEGMENTS.has(segment));

const isPatch = (patch: unknown): boolean => isObject(patch) && isSafePath(patch.path);

const isEntry = (entry: unknown): boolean =>
  isObject(entry) && Array.isArray(entry.patches) && entry.patches.every(isPatch);

const isEntryList = (list: unknown): boolean => Array.isArray(list) && list.every(isEntry);

/**
 * Structural check for a record read from storage, which may be corrupt or tampered with.
 * Rejects paths that could reach `Object.prototype` when applied to the form.
 */
export function isPersistedRecord(value: unknown): value is PersistedFormHistory {
  if (!isObject(value)) return false;
  const { version, savedAt, values, history, base } = value;
  if (typeof version !== 'number' || !Number.isFinite(savedAt)) return false;
  if (!isObject(values) || Array.isArray(values)) return false;
  if (base !== undefined && (!isObject(base) || Array.isArray(base))) return false;
  return (
    isObject(history) &&
    isEntryList(history.past) &&
    isEntryList(history.future) &&
    (history.group === null || typeof history.group === 'string') &&
    Number.isFinite(history.updatedAt)
  );
}

import { deepEqual, diff, type Patch } from './history';

export type Conflict = { path: string; base: unknown; mine: unknown; theirs: unknown };
/** Per conflict path; unresolved conflicts keep `theirs`. */
export type Resolutions = Record<string, 'mine' | 'theirs'>;
export type MergeResult<T = unknown> = {
  merged: T;
  /** Own changes written onto `theirs`, as patches from theirs → merged. */
  applied: Patch[];
  conflicts: Conflict[];
};

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Three-way merge of `mine` onto `theirs`, both derived from `base`.
 * Own changes that don't overlap a change on `theirs` are applied; overlapping
 * changes with different results are reported as conflicts at the outermost
 * overlapping path and keep the `theirs` value unless resolved as `'mine'`.
 * Never mutates its inputs.
 */
export function merge3<T>(
  base: T,
  mine: T,
  theirs: T,
  resolutions: Resolutions = {},
): MergeResult<T> {
  const mineChanges = diff(base, mine);
  const theirChanges = diff(base, theirs);

  let merged: unknown = structuredClone(theirs);
  const applied: Patch[] = [];
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  for (const change of mineChanges) {
    const overlapping = theirChanges.filter((t) => overlaps(change.path, t.path));
    const path = [change.path, ...overlapping.map((t) => t.path)].reduce((a, b) =>
      depth(b) < depth(a) ? b : a,
    );
    if (seen.has(path)) continue;
    seen.add(path);

    const mineValue = getPath(mine, path);
    const theirValue = getPath(theirs, path);
    if (overlapping.length > 0) {
      if (deepEqual(mineValue, theirValue)) continue;
      conflicts.push({ path, base: getPath(base, path), mine: mineValue, theirs: theirValue });
      if (resolutions[path] !== 'mine') continue;
    }
    merged = setPath(merged, path, structuredClone(mineValue));
    applied.push({ path, before: theirValue, after: mineValue });
  }

  return { merged: merged as T, applied, conflicts };
}

const segments = (path: string): string[] => (path === '' ? [] : path.split('.'));
const depth = (path: string): number => segments(path).length;

function overlaps(a: string, b: string): boolean {
  return a === b || a === '' || b === '' || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

function checkSegment(segment: string): string {
  if (FORBIDDEN_SEGMENTS.has(segment)) throw new Error(`Refusing unsafe path segment "${segment}"`);
  return segment;
}

function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of segments(path)) {
    checkSegment(segment);
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Writes in place and returns the (possibly replaced) root. */
function setPath(root: unknown, path: string, value: unknown): unknown {
  const keys = segments(path);
  if (keys.length === 0) return value;

  let current = root as Record<string, unknown>;
  keys.forEach(checkSegment);
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];
    if (typeof next !== 'object' || next === null) {
      current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return root;
}

import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  deepEqual,
  diff,
  record,
  redo,
  seal,
  undo,
  type History,
  type Patch,
} from './history';

const p = (path: string, before: unknown, after: unknown): Patch => ({ path, before, after });

describe('createHistory', () => {
  it('should return an empty history when created', () => {
    expect(createHistory()).toEqual({ past: [], future: [], group: null, updatedAt: 0 });
  });
});

describe('record', () => {
  it('should push an entry when a changed patch is recorded', () => {
    const h = record(createHistory(), [p('a', 1, 2)], { now: 1000 });
    expect(h.past).toEqual([{ patches: [p('a', 1, 2)] }]);
    expect(h.updatedAt).toBe(1000);
    expect(h.group).toBeNull();
  });

  it('should filter out patches when before equals after', () => {
    const h = record(
      createHistory(),
      [p('a', 1, 1), p('b', { x: [1] }, { x: [1] }), p('c', 1, 2)],
      { now: 1 },
    );
    expect(h.past).toEqual([{ patches: [p('c', 1, 2)] }]);
  });

  it('should return the same reference when no patches remain after filtering', () => {
    const h = createHistory();
    expect(record(h, [p('a', 1, 1)], { now: 1 })).toBe(h);
    expect(record(h, [], { now: 1 })).toBe(h);
  });

  it('should clear the future when recording', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    h = undo(h).history;
    expect(canRedo(h)).toBe(true);
    h = record(h, [p('b', 1, 2)], { now: 2 });
    expect(h.future).toEqual([]);
  });

  it('should coalesce when the same group is recorded within the window', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1200, mergeWindowMs: 500 });
    expect(h.past).toHaveLength(1);
    expect(h.updatedAt).toBe(1200);
    expect(h.group).toBe('g');
  });

  it('should coalesce when the elapsed time equals the window exactly', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1500, mergeWindowMs: 500 });
    expect(h.past).toHaveLength(1);
  });

  it('should keep the original before and the newest after when the same path is merged', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1100 });
    expect(h.past[0].patches).toEqual([p('a', 1, 3)]);
  });

  it('should append new paths when merging into an existing entry', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3), p('b', 'x', 'y')], { group: 'g', now: 1100 });
    expect(h.past[0].patches).toEqual([p('a', 1, 3), p('b', 'x', 'y')]);
  });

  it('should clear the future when coalescing', () => {
    let h = record(createHistory(), [p('z', 0, 1)], { now: 1 });
    h = record(h, [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1100 });
    expect(h.future).toEqual([]);
  });

  it('should remove the entry and reset the group when a coalesced entry becomes a no-op', () => {
    let h = record(createHistory(), [p('z', 0, 1)], { now: 1 });
    h = record(h, [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 1)], { group: 'g', now: 1100 });
    expect(h.past).toEqual([{ patches: [p('z', 0, 1)] }]);
    expect(h.group).toBeNull();
    expect(h.updatedAt).toBe(1100);
  });

  it('should leave an empty past when the only entry becomes a no-op', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 1)], { group: 'g', now: 1100 });
    expect(h.past).toEqual([]);
    expect(h.group).toBeNull();
  });

  it('should keep other patches when only one merged path returns to its original value', () => {
    let h = record(createHistory(), [p('a', 1, 2), p('b', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 1)], { group: 'g', now: 1100 });
    expect(h.past[0].patches).toEqual([p('b', 1, 2)]);
    expect(h.group).toBe('g');
  });

  it('should not coalesce when the groups differ', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g1', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g2', now: 1100 });
    expect(h.past).toHaveLength(2);
  });

  it('should not coalesce when the window has elapsed', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1501, mergeWindowMs: 500 });
    expect(h.past).toHaveLength(2);
  });

  it('should not coalesce when the group is null', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: null, now: 1000 });
    h = record(h, [p('a', 2, 3)], { group: null, now: 1100 });
    expect(h.past).toHaveLength(2);
  });

  it('should not coalesce when past is empty', () => {
    const start: History = { past: [], future: [], group: 'g', updatedAt: 1000 };
    const h = record(start, [p('a', 1, 2)], { group: 'g', now: 1100 });
    expect(h.past).toEqual([{ patches: [p('a', 1, 2)] }]);
    expect(h.group).toBe('g');
  });

  it('should drop the oldest entries when the limit is exceeded', () => {
    let h = createHistory();
    for (let i = 0; i < 4; i++) h = record(h, [p('a', i, i + 1)], { now: i * 1000, limit: 3 });
    expect(h.past.map((e) => e.patches[0].before)).toEqual([1, 2, 3]);
  });

  it('should use a custom isEqual when filtering and merging', () => {
    const isEqual = (a: unknown, b: unknown): boolean =>
      String(a).toLowerCase() === String(b).toLowerCase();
    const h = record(createHistory(), [p('a', 'X', 'x'), p('b', 'x', 'y')], { now: 1, isEqual });
    expect(h.past[0].patches).toEqual([p('b', 'x', 'y')]);

    let g = record(createHistory(), [p('a', 'x', 'y')], { group: 'g', now: 1, isEqual });
    g = record(g, [p('a', 'y', 'X')], { group: 'g', now: 2, isEqual });
    expect(g.past).toEqual([]);
  });
});

describe('undo', () => {
  it('should return reversed changes with the before values when undoing', () => {
    const h = record(createHistory(), [p('a', 1, 2), p('b', 'x', 'y')], { now: 1 });
    const { changes } = undo(h);
    expect(changes).toEqual([
      { path: 'b', value: 'x' },
      { path: 'a', value: 1 },
    ]);
  });

  it('should move the entry to the front of the future when undoing', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    h = record(h, [p('b', 1, 2)], { now: 2 });
    const first = undo(h).history;
    expect(first.past).toEqual([{ patches: [p('a', 1, 2)] }]);
    expect(first.future).toEqual([{ patches: [p('b', 1, 2)] }]);
    const second = undo(first).history;
    expect(second.future).toEqual([{ patches: [p('a', 1, 2)] }, { patches: [p('b', 1, 2)] }]);
  });

  it('should reset group and updatedAt when undoing', () => {
    const h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    const { history } = undo(h);
    expect(history.group).toBeNull();
    expect(history.updatedAt).toBe(0);
  });

  it('should return the same history and no changes when at the start', () => {
    const h = createHistory();
    const result = undo(h);
    expect(result.history).toBe(h);
    expect(result.changes).toEqual([]);
  });

  it('should not merge the next record into the previous group when recorded after an undo', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { now: 1000 });
    h = record(h, [p('b', 1, 2)], { group: 'g', now: 1100 });
    h = undo(h).history;
    h = record(h, [p('c', 1, 2)], { group: 'g', now: 1200 });
    expect(h.past).toHaveLength(2);
    expect(h.past[1].patches).toEqual([p('c', 1, 2)]);
  });
});

describe('redo', () => {
  it('should return changes in order with the after values when redoing', () => {
    let h = record(createHistory(), [p('a', 1, 2), p('b', 'x', 'y')], { now: 1 });
    h = undo(h).history;
    expect(redo(h).changes).toEqual([
      { path: 'a', value: 2 },
      { path: 'b', value: 'y' },
    ]);
  });

  it('should move the entry back to past when redoing', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    h = undo(h).history;
    const { history } = redo(h);
    expect(history.past).toEqual([{ patches: [p('a', 1, 2)] }]);
    expect(history.future).toEqual([]);
    expect(history.group).toBeNull();
    expect(history.updatedAt).toBe(0);
  });

  it('should return the same history and no changes when the future is empty', () => {
    const h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    const result = redo(h);
    expect(result.history).toBe(h);
    expect(result.changes).toEqual([]);
  });

  it('should restore the state when undo is followed by redo', () => {
    const h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    expect(redo(undo(h).history).history).toEqual({ ...h, group: null, updatedAt: 0 });
  });
});

describe('seal', () => {
  it('should reset the group when a group is active', () => {
    const h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    const sealed = seal(h);
    expect(sealed.group).toBeNull();
    expect(sealed.past).toBe(h.past);
  });

  it('should return the same reference when no group is active', () => {
    const h = createHistory();
    expect(seal(h)).toBe(h);
  });

  it('should prevent coalescing when sealed before the next record', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { group: 'g', now: 1000 });
    h = seal(h);
    h = record(h, [p('a', 2, 3)], { group: 'g', now: 1100 });
    expect(h.past).toHaveLength(2);
  });
});

describe('canUndo / canRedo', () => {
  it('should be false for both when history is empty', () => {
    const h = createHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('should report canUndo after record and canRedo after undo', () => {
    let h = record(createHistory(), [p('a', 1, 2)], { now: 1 });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undo(h).history;
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
  });
});

describe('diff', () => {
  it('should return no patches when values are equal', () => {
    expect(diff({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toEqual([]);
    expect(diff(1, 1)).toEqual([]);
  });

  it('should produce a dot path when a nested leaf changes', () => {
    expect(diff({ a: { b: 1 } }, { a: { b: 2 } })).toEqual([p('a.b', 1, 2)]);
  });

  it('should produce an indexed dot path when an array item field changes', () => {
    const before = { skills: [{ label: 'a' }, { label: 'b' }] };
    const after = { skills: [{ label: 'a' }, { label: 'c' }] };
    expect(diff(before, after)).toEqual([p('skills.1.label', 'b', 'c')]);
    expect(diff({ skills: [{ label: 'x' }] }, { skills: [{ label: 'y' }] })).toEqual([
      p('skills.0.label', 'x', 'y'),
    ]);
  });

  it('should report an added key when the object gains a key', () => {
    expect(diff({ a: 1 }, { a: 1, b: 2 })).toEqual([p('b', undefined, 2)]);
  });

  it('should report a removed key when the object loses a key', () => {
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual([p('b', 2, undefined)]);
  });

  it('should produce a single patch at the array path when lengths differ', () => {
    expect(diff({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual([p('list', [1, 2], [1, 2, 3])]);
  });

  it('should produce per-index paths when arrays have the same length', () => {
    expect(diff({ list: [1, 2, 3] }, { list: [1, 5, 6] })).toEqual([
      p('list.1', 2, 5),
      p('list.2', 3, 6),
    ]);
  });

  it('should compare Dates by time and treat them as leaves', () => {
    expect(diff({ d: new Date(5) }, { d: new Date(5) })).toEqual([]);
    const a = new Date(5);
    const b = new Date(9);
    expect(diff({ d: a }, { d: b })).toEqual([p('d', a, b)]);
  });

  it('should produce one patch when the type changes from object to primitive', () => {
    expect(diff({ a: { b: 1 } }, { a: 5 })).toEqual([p('a', { b: 1 }, 5)]);
  });

  it('should produce one patch when an array becomes an object', () => {
    expect(diff({ a: [1] }, { a: { 0: 1 } })).toEqual([p('a', [1], { 0: 1 })]);
  });

  it('should produce a patch with an empty path when root primitives differ', () => {
    expect(diff(1, 2)).toEqual([p('', 1, 2)]);
  });
});

describe('deepEqual', () => {
  it('should return true when nested objects are structurally equal', () => {
    expect(deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } })).toBe(true);
  });

  it('should return false when nested values differ', () => {
    expect(deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } })).toBe(false);
  });

  it('should return false when comparing an array with an object', () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({ 0: 'a' }, ['a'])).toBe(false);
  });

  it('should compare Dates by time', () => {
    expect(deepEqual(new Date(1), new Date(1))).toBe(true);
    expect(deepEqual(new Date(1), new Date(2))).toBe(false);
  });

  it('should return false when key sets differ', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  });

  it('should handle primitives and null', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
  });
});

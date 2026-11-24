import { describe, expect, it } from 'vitest';
import { merge3 } from './merge';

describe('merge3', () => {
  it('should apply own changes when theirs did not touch those paths', () => {
    const base = { name: 'a', email: 'x', age: 1 };
    const result = merge3(base, { ...base, name: 'mine' }, { ...base, email: 'theirs' });

    expect(result.merged).toEqual({ name: 'mine', email: 'theirs', age: 1 });
    expect(result.applied).toEqual([{ path: 'name', before: 'a', after: 'mine' }]);
    expect(result.conflicts).toEqual([]);
  });

  it('should report a conflict and keep theirs when both sides changed a path to different values', () => {
    const base = { name: 'a' };
    const result = merge3(base, { name: 'mine' }, { name: 'theirs' });

    expect(result.conflicts).toEqual([{ path: 'name', base: 'a', mine: 'mine', theirs: 'theirs' }]);
    expect(result.merged).toEqual({ name: 'theirs' });
    expect(result.applied).toEqual([]);
  });

  it('should not report a conflict when both sides changed a path to equal values', () => {
    const base = { name: 'a' };
    const result = merge3(base, { name: 'same' }, { name: 'same' });

    expect(result.conflicts).toEqual([]);
    expect(result.applied).toEqual([]);
    expect(result.merged).toEqual({ name: 'same' });
  });

  it('should compare Date values by time when both sides changed a path', () => {
    const base = { at: new Date(0) };
    const equal = merge3(base, { at: new Date(5) }, { at: new Date(5) });
    const differ = merge3(base, { at: new Date(5) }, { at: new Date(6) });

    expect(equal.conflicts).toEqual([]);
    expect(differ.conflicts).toHaveLength(1);
    expect(differ.conflicts[0].path).toBe('at');
  });

  it('should report the conflict at the outermost path when a change overlaps an ancestor', () => {
    const base = { address: { city: 'a', zip: '1' } };
    const mine = { address: { city: 'mine', zip: '1' } };
    const theirs = { address: { city: 'a', zip: '2' } };
    const result = merge3(base, mine, { address: null } as unknown as typeof base);
    const reverse = merge3(base, { address: null } as unknown as typeof base, theirs);

    expect(result.conflicts).toEqual([
      { path: 'address', base: base.address, mine: mine.address, theirs: null },
    ]);
    expect(reverse.conflicts.map((c) => c.path)).toEqual(['address']);
  });

  it('should merge sibling leaves independently when they do not overlap', () => {
    const base = { address: { city: 'a', zip: '1' } };
    const result = merge3(
      base,
      { address: { city: 'mine', zip: '1' } },
      { address: { city: 'a', zip: '2' } },
    );

    expect(result.merged).toEqual({ address: { city: 'mine', zip: '2' } });
    expect(result.conflicts).toEqual([]);
  });

  it('should not treat a.1 as overlapping a.10 when comparing paths', () => {
    const base = { a: Array.from({ length: 11 }, (_, i) => i) };
    const mine = structuredClone(base);
    mine.a[1] = 100;
    const theirs = structuredClone(base);
    theirs.a[10] = 200;
    const result = merge3(base, mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.a[1]).toBe(100);
    expect(result.merged.a[10]).toBe(200);
  });

  it('should treat an array as one path when its length differs', () => {
    const base = { tags: ['a', 'b'] };
    const result = merge3(base, { tags: ['a', 'x'] }, { tags: ['a', 'b', 'c'] });

    expect(result.conflicts).toEqual([
      { path: 'tags', base: ['a', 'b'], mine: ['a', 'x'], theirs: ['a', 'b', 'c'] },
    ]);
    expect(result.merged).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('should apply an own array change whole when only length differs on mine', () => {
    const base = { tags: ['a'], name: 'n' };
    const result = merge3(base, { tags: ['a', 'b'], name: 'n' }, { tags: ['a'], name: 'z' });

    expect(result.merged).toEqual({ tags: ['a', 'b'], name: 'z' });
    expect(result.applied).toEqual([{ path: 'tags', before: ['a'], after: ['a', 'b'] }]);
  });

  it('should use the own value when a conflict is resolved as mine', () => {
    const base = { name: 'a', tags: ['x'] };
    const mine = { name: 'mine', tags: ['x', 'y'] };
    const theirs = { name: 'theirs', tags: ['x', 'z'] };
    const result = merge3(base, mine, theirs, { name: 'mine' });

    expect(result.merged).toEqual({ name: 'mine', tags: ['x', 'z'] });
    expect(result.conflicts.map((c) => c.path)).toEqual(['name', 'tags']);
    expect(result.applied).toEqual([{ path: 'name', before: 'theirs', after: 'mine' }]);
  });

  it('should keep theirs when a conflict is resolved as theirs or left unresolved', () => {
    const base = { name: 'a' };
    const explicit = merge3(base, { name: 'mine' }, { name: 'theirs' }, { name: 'theirs' });
    const unresolved = merge3(base, { name: 'mine' }, { name: 'theirs' }, { other: 'mine' });

    expect(explicit.merged).toEqual({ name: 'theirs' });
    expect(unresolved.merged).toEqual({ name: 'theirs' });
  });

  it('should write the whole own value when resolving an ancestor conflict as mine', () => {
    const base = { address: { city: 'a', zip: '1' } };
    const mine = { address: { city: 'mine', zip: '1' } };
    const theirs = { address: null } as unknown as typeof base;
    const result = merge3(base, mine, theirs, { address: 'mine' });

    expect(result.merged).toEqual(mine);
    expect(result.applied).toEqual([{ path: 'address', before: null, after: mine.address }]);
  });

  it('should not mutate its inputs when merging', () => {
    const base = { a: { b: 1 }, list: [1] };
    const mine = { a: { b: 2 }, list: [1, 2] };
    const theirs = { a: { b: 1 }, list: [1, 3] };
    const snapshots = [structuredClone(base), structuredClone(mine), structuredClone(theirs)];
    const result = merge3(base, mine, theirs, { list: 'mine' });

    expect([base, mine, theirs]).toEqual(snapshots);
    expect(result.merged).not.toBe(theirs);
    expect(result.merged.list).not.toBe(mine.list);
  });

  it('should refuse unsafe path segments when a value has such a key', () => {
    const base = JSON.parse('{"__proto__":{"polluted":1}}');
    const mine = JSON.parse('{"__proto__":{"polluted":2}}');

    expect(() => merge3(base, mine, base)).toThrow(/unsafe path segment/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('should replace the root when the values are not containers', () => {
    const result = merge3(1, 2, 1);

    expect(result.merged).toBe(2);
    expect(result.applied).toEqual([{ path: '', before: 1, after: 2 }]);
  });
});

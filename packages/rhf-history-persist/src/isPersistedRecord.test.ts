import { describe, expect, test } from 'vitest';
import { isPersistedRecord } from './isPersistedRecord';

const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  savedAt: 1000,
  values: { name: 'a' },
  history: {
    past: [{ patches: [{ path: 'name', before: '', after: 'a' }] }],
    future: [],
    group: 'name',
    updatedAt: 1000,
  },
  ...overrides,
});

const withPath = (path: unknown): Record<string, unknown> =>
  record({
    history: {
      past: [{ patches: [{ path, before: 1, after: 2 }] }],
      future: [],
      group: null,
      updatedAt: 1,
    },
  });

describe('isPersistedRecord', () => {
  test('should accept the record when it is well formed', () => {
    expect(isPersistedRecord(record())).toBe(true);
  });

  test('should accept the record when history is empty', () => {
    const empty = { past: [], future: [], group: null, updatedAt: 0 };
    expect(isPersistedRecord(record({ history: empty }))).toBe(true);
  });

  test('should accept the record when a patch has an undefined before', () => {
    const history = {
      past: [
        {
          patches: [
            { path: 'a', before: undefined, after: 1 },
            { path: 'b', after: 1 },
          ],
        },
      ],
      future: [],
      group: null,
      updatedAt: 1,
    };
    expect(isPersistedRecord(record({ history }))).toBe(true);
  });

  test.each([null, undefined, 'record', 42, []])(
    'should not throw or accept when value is %j',
    (value) => {
      expect(isPersistedRecord(value)).toBe(false);
    },
  );

  test.each([
    ['savedAt is NaN', { savedAt: NaN }],
    ['savedAt is missing', { savedAt: undefined }],
    ['savedAt is a string', { savedAt: '1000' }],
    ['savedAt is Infinity', { savedAt: Infinity }],
    ['version is missing', { version: undefined }],
    ['version is a string', { version: '1' }],
    ['values is null', { values: null }],
    ['values is an array', { values: [] }],
    ['history is missing', { history: undefined }],
    [
      'history.past is not an array',
      { history: { past: {}, future: [], group: null, updatedAt: 1 } },
    ],
    ['history.future is missing', { history: { past: [], group: null, updatedAt: 1 } }],
    ['history.group is a number', { history: { past: [], future: [], group: 1, updatedAt: 1 } }],
    [
      'history.updatedAt is NaN',
      { history: { past: [], future: [], group: null, updatedAt: NaN } },
    ],
    ['an entry has no patches', { history: { past: [{}], future: [], group: null, updatedAt: 1 } }],
    ['an entry is null', { history: { past: [null], future: [], group: null, updatedAt: 1 } }],
    [
      'a patch has no path',
      {
        history: {
          past: [{ patches: [{ before: 1, after: 2 }] }],
          future: [],
          group: null,
          updatedAt: 1,
        },
      },
    ],
    [
      'a patch path is not a string',
      { history: { past: [{ patches: [{ path: 1 }] }], future: [], group: null, updatedAt: 1 } },
    ],
    [
      'a patch path is empty',
      { history: { past: [{ patches: [{ path: '' }] }], future: [], group: null, updatedAt: 1 } },
    ],
  ])('should reject the record when %s', (_name, overrides) => {
    expect(isPersistedRecord(record(overrides))).toBe(false);
  });

  test.each([
    '__proto__.x',
    'a.constructor',
    'a[prototype]',
    'items[0].__proto__',
    'a.__proto__.b',
    "a['__proto__'].x",
    'a["constructor"].x',
    '__pro"to__.x',
    "__pro'to__.x",
    '__pro|to__.x',
    '__pro]to__.x',
  ])('should reject the record when a patch path is %s', (path) => {
    expect(isPersistedRecord(withPath(path))).toBe(false);
  });

  test('should reject the record when a forbidden path is in future', () => {
    const history = {
      past: [],
      future: [{ patches: [{ path: 'a.constructor.b', before: 1, after: 2 }] }],
      group: null,
      updatedAt: 1,
    };
    expect(isPersistedRecord(record({ history }))).toBe(false);
  });

  test('should accept the record when a path only contains forbidden words as substrings', () => {
    expect(isPersistedRecord(withPath('constructors.prototypes[0].__proto'))).toBe(true);
  });

  test('should accept the record when base is an object', () => {
    expect(isPersistedRecord(record({ base: { name: '' } }))).toBe(true);
  });

  test('should accept the record when base is absent', () => {
    expect(isPersistedRecord(record({ base: undefined }))).toBe(true);
  });

  test.each([null, [], 'x', 1, true])('should reject the record when base is %j', (base) => {
    expect(isPersistedRecord(record({ base }))).toBe(false);
  });
});

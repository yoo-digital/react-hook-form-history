import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbStorage } from './indexedDbStorage';
import {
  createMemoryStorage,
  DraftsClearedError,
  nullStorage,
  type FormHistoryStorage,
  type PersistedFormHistory,
  type RevisionKey,
} from './storage';

function makeRecord(
  savedAt: number,
  values: Record<string, unknown> = { name: 'a' },
): PersistedFormHistory {
  return { version: 1, savedAt, values, history: { past: [], future: [] } as never };
}

const rev = (scope: string, document: string, revision: string): RevisionKey => ({
  scope,
  document,
  revision,
});

const sorted = (
  list: Array<{ revision: string; savedAt: number }>,
): Array<{ revision: string; savedAt: number }> =>
  [...list].sort((a, b) => (a.revision < b.revision ? -1 : 1));

describe.each<[string, () => FormHistoryStorage]>([
  ['createMemoryStorage', (): FormHistoryStorage => createMemoryStorage()],
  [
    'createIndexedDbStorage',
    (): FormHistoryStorage => createIndexedDbStorage({ indexedDB: new IDBFactory(), IDBKeyRange }),
  ],
])('FormHistoryStorage contract: %s', (_name, create) => {
  describe('clearAll', () => {
    it('should remove every record when clearAll is called', async () => {
      const storage = create();
      await storage.save('a', makeRecord(1));
      await storage.save('b', makeRecord(2));
      await storage.save('c', makeRecord(3));

      await storage.clearAll();

      await expect(storage.load('a')).resolves.toBeUndefined();
      await expect(storage.load('b')).resolves.toBeUndefined();
      await expect(storage.load('c')).resolves.toBeUndefined();
    });

    it('should resolve when clearAll is called on empty storage', async () => {
      await expect(create().clearAll()).resolves.toBeUndefined();
    });

    it('should save and load again when used after clearAll', async () => {
      const storage = create();
      await storage.save('a', makeRecord(1));
      await storage.clearAll();

      await storage.save('a', makeRecord(5, { fresh: true }));

      expect((await storage.load('a'))?.values).toEqual({ fresh: true });
    });

    it('should leave nothing for removeOlderThan to delete when clearAll was called', async () => {
      const storage = create();
      await storage.save('a', makeRecord(1));
      await storage.clearAll();

      await expect(storage.removeOlderThan(1000)).resolves.toBe(0);
    });
  });

  describe('removeOlderThan', () => {
    it('should resolve 0 when storage is empty', async () => {
      await expect(create().removeOlderThan(1000)).resolves.toBe(0);
    });

    it('should delete only records with savedAt strictly older than the timestamp', async () => {
      const storage = create();
      await storage.save('old', makeRecord(50));
      await storage.save('older', makeRecord(10));
      await storage.save('edge', makeRecord(100));
      await storage.save('new', makeRecord(150));

      const removed = await storage.removeOlderThan(100);

      expect(removed).toBe(2);
      await expect(storage.load('old')).resolves.toBeUndefined();
      await expect(storage.load('older')).resolves.toBeUndefined();
      expect((await storage.load('edge'))?.savedAt).toBe(100);
      expect((await storage.load('new'))?.savedAt).toBe(150);
    });

    it('should keep a record when its savedAt equals the timestamp', async () => {
      const storage = create();
      await storage.save('edge', makeRecord(100));

      await expect(storage.removeOlderThan(100)).resolves.toBe(0);
      await expect(storage.load('edge')).resolves.toBeDefined();
    });

    it('should delete everything when all records are older', async () => {
      const storage = create();
      await storage.save('a', makeRecord(1));
      await storage.save('b', makeRecord(2));

      await expect(storage.removeOlderThan(1000)).resolves.toBe(2);
      await expect(storage.load('a')).resolves.toBeUndefined();
      await expect(storage.load('b')).resolves.toBeUndefined();
    });

    it('should delete nothing when all records are newer', async () => {
      const storage = create();
      await storage.save('a', makeRecord(500));
      await storage.save('b', makeRecord(600));

      await expect(storage.removeOlderThan(100)).resolves.toBe(0);
      await expect(storage.load('a')).resolves.toBeDefined();
      await expect(storage.load('b')).resolves.toBeDefined();
    });

    it('should delete the expired records when they were inserted in unsorted order', async () => {
      const storage = create();
      await storage.save('k1', makeRecord(500));
      await storage.save('k2', makeRecord(20));
      await storage.save('k3', makeRecord(300));
      await storage.save('k4', makeRecord(10));
      await storage.save('k5', makeRecord(100));
      await storage.save('k6', makeRecord(30));

      const removed = await storage.removeOlderThan(100);

      expect(removed).toBe(3);
      await expect(storage.load('k2')).resolves.toBeUndefined();
      await expect(storage.load('k4')).resolves.toBeUndefined();
      await expect(storage.load('k6')).resolves.toBeUndefined();
      await expect(storage.load('k1')).resolves.toBeDefined();
      await expect(storage.load('k3')).resolves.toBeDefined();
      await expect(storage.load('k5')).resolves.toBeDefined();
    });

    it('should count a re-saved key once when its savedAt was updated', async () => {
      const storage = create();
      await storage.save('k', makeRecord(10));
      await storage.save('k', makeRecord(500));

      await expect(storage.removeOlderThan(100)).resolves.toBe(0);
      expect((await storage.load('k'))?.savedAt).toBe(500);
    });

    it('should delete records with identical savedAt when they are all expired', async () => {
      const storage = create();
      await storage.save('a', makeRecord(10));
      await storage.save('b', makeRecord(10));
      await storage.save('c', makeRecord(10));

      await expect(storage.removeOlderThan(11)).resolves.toBe(3);
    });
  });
  describe('revision keys', () => {
    it('should keep a string key and a revision key apart when they look alike', async () => {
      const storage = create();
      await storage.save('u1', makeRecord(1, { kind: 'string' }));
      await storage.save(rev('u1', 'asset-4', 'r1'), makeRecord(2, { kind: 'revision' }));
      await storage.save(
        JSON.stringify(rev('u1', 'asset-4', 'r1')),
        makeRecord(3, { kind: 'lookalike' }),
      );

      expect((await storage.load('u1'))?.values).toEqual({ kind: 'string' });
      expect((await storage.load(rev('u1', 'asset-4', 'r1')))?.values).toEqual({
        kind: 'revision',
      });
      expect((await storage.load(JSON.stringify(rev('u1', 'asset-4', 'r1'))))?.values).toEqual({
        kind: 'lookalike',
      });
    });

    it('should round-trip revisions containing special characters when saved and loaded', async () => {
      const storage = create();
      const revisions = ['v-1', 'v"2', 'v/3', 'a-b"c/d'];
      for (const [i, revision] of revisions.entries()) {
        await storage.save(rev('s', 'd', revision), makeRecord(i, { revision }));
      }

      for (const revision of revisions) {
        expect((await storage.load(rev('s', 'd', revision)))?.values).toEqual({ revision });
      }
      expect(sorted(await storage.listRevisions('s', 'd')).map((r) => r.revision)).toEqual(
        [...revisions].sort(),
      );
    });

    it('should remove only the given revision when remove is called with a revision key', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(1));
      await storage.save(rev('s', 'd', 'r2'), makeRecord(2));

      await storage.remove(rev('s', 'd', 'r1'));

      await expect(storage.load(rev('s', 'd', 'r1'))).resolves.toBeUndefined();
      await expect(storage.load(rev('s', 'd', 'r2'))).resolves.toBeDefined();
    });

    it('should remove revision records when clearAll is called', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(1));

      await storage.clearAll();

      await expect(storage.load(rev('s', 'd', 'r1'))).resolves.toBeUndefined();
      await expect(storage.listRevisions('s', 'd')).resolves.toEqual([]);
    });

    it('should delete expired revision records when removeOlderThan is called', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'old'), makeRecord(10));
      await storage.save(rev('s', 'd', 'new'), makeRecord(500));
      await storage.save('plain', makeRecord(20));

      await expect(storage.removeOlderThan(100)).resolves.toBe(2);

      expect(await storage.listRevisions('s', 'd')).toEqual([{ revision: 'new', savedAt: 500 }]);
    });
  });

  describe('listRevisions', () => {
    it('should resolve an empty list when nothing is stored', async () => {
      await expect(create().listRevisions('s', 'd')).resolves.toEqual([]);
    });

    it('should list every revision with its savedAt when several are stored', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(10));
      await storage.save(rev('s', 'd', 'r2'), makeRecord(20));

      expect(sorted(await storage.listRevisions('s', 'd'))).toEqual([
        { revision: 'r1', savedAt: 10 },
        { revision: 'r2', savedAt: 20 },
      ]);
    });

    it('should not mix documents when one id is a prefix of another', async () => {
      const storage = create();
      await storage.save(rev('s', 'asset-4', 'r1'), makeRecord(1));
      await storage.save(rev('s', 'asset-42', 'r2'), makeRecord(2));

      expect(await storage.listRevisions('s', 'asset-4')).toEqual([{ revision: 'r1', savedAt: 1 }]);
      expect(await storage.listRevisions('s', 'asset-42')).toEqual([
        { revision: 'r2', savedAt: 2 },
      ]);
    });

    it('should exclude other scopes when listing', async () => {
      const storage = create();
      await storage.save(rev('alice', 'd', 'r1'), makeRecord(1));
      await storage.save(rev('bob', 'd', 'r2'), makeRecord(2));

      expect(await storage.listRevisions('alice', 'd')).toEqual([{ revision: 'r1', savedAt: 1 }]);
    });

    it('should not include string keys when listing', async () => {
      const storage = create();
      await storage.save('d', makeRecord(1));
      await storage.save('s', makeRecord(2));

      await expect(storage.listRevisions('s', 'd')).resolves.toEqual([]);
    });

    it('should see a save that has not resolved yet when called right after it', async () => {
      const storage = create();

      const saving = storage.save(rev('s', 'd', 'r1'), makeRecord(7));
      const listing = storage.listRevisions('s', 'd');

      await expect(listing).resolves.toEqual([{ revision: 'r1', savedAt: 7 }]);
      await saving;
    });
  });

  describe('removeRevisions', () => {
    it('should delete every revision of the document when keep is omitted', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(1));
      await storage.save(rev('s', 'd', 'r2'), makeRecord(2));

      await storage.removeRevisions('s', 'd');

      await expect(storage.listRevisions('s', 'd')).resolves.toEqual([]);
    });

    it('should preserve the kept revision when keep is given', async () => {
      const storage = create();
      for (const revision of ['a', 'm', 'z'])
        await storage.save(rev('s', 'd', revision), makeRecord(1, { revision }));

      await storage.removeRevisions('s', 'd', 'm');

      expect(await storage.listRevisions('s', 'd')).toEqual([{ revision: 'm', savedAt: 1 }]);
      expect((await storage.load(rev('s', 'd', 'm')))?.values).toEqual({ revision: 'm' });
    });

    it('should delete everything when keep names a revision that does not exist', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(1));

      await storage.removeRevisions('s', 'd', 'missing');

      await expect(storage.listRevisions('s', 'd')).resolves.toEqual([]);
    });

    it('should leave other documents, scopes and string keys alone when removing', async () => {
      const storage = create();
      await storage.save(rev('s', 'asset-4', 'r1'), makeRecord(1));
      await storage.save(rev('s', 'asset-42', 'r1'), makeRecord(2));
      await storage.save(rev('other', 'asset-4', 'r1'), makeRecord(3));
      await storage.save('asset-4', makeRecord(4));

      await storage.removeRevisions('s', 'asset-4');

      await expect(storage.listRevisions('s', 'asset-4')).resolves.toEqual([]);
      await expect(storage.listRevisions('s', 'asset-42')).resolves.toHaveLength(1);
      await expect(storage.listRevisions('other', 'asset-4')).resolves.toHaveLength(1);
      await expect(storage.load('asset-4')).resolves.toBeDefined();
    });

    it('should be seen by a listRevisions called right after it when it has not resolved yet', async () => {
      const storage = create();
      await storage.save(rev('s', 'd', 'r1'), makeRecord(1));

      const removing = storage.removeRevisions('s', 'd');
      const listing = storage.listRevisions('s', 'd');

      await expect(listing).resolves.toEqual([]);
      await removing;
    });
  });

  describe('clear epoch', () => {
    it('should reject saving a revision key when another context called clearAll', async () => {
      const indexedDB = new IDBFactory();
      const stale = createIndexedDbStorage({ indexedDB, IDBKeyRange });
      const other = createIndexedDbStorage({ indexedDB, IDBKeyRange });
      await stale.listRevisions('s', 'd'); // opens the connection and remembers the epoch
      await other.clearAll();

      await expect(stale.save(rev('s', 'd', 'r1'), makeRecord(1))).rejects.toBeInstanceOf(
        DraftsClearedError,
      );
      await expect(other.listRevisions('s', 'd')).resolves.toEqual([]);
    });
  });
});

describe('nullStorage', () => {
  it('should resolve 0 when removeOlderThan is called', async () => {
    await expect(nullStorage.removeOlderThan(1000)).resolves.toBe(0);
  });

  it('should resolve when clearAll is called', async () => {
    await expect(nullStorage.clearAll()).resolves.toBeUndefined();
  });

  it('should resolve an empty list when listRevisions is called', async () => {
    await expect(nullStorage.listRevisions('s', 'd')).resolves.toEqual([]);
  });

  it('should resolve when removeRevisions is called', async () => {
    await expect(nullStorage.removeRevisions('s', 'd', 'r1')).resolves.toBeUndefined();
  });
});

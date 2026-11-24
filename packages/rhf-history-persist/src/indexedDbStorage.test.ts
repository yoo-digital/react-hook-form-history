import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbStorage } from './indexedDbStorage';
import { DraftsClearedError, type PersistedFormHistory } from './storage';

function makeRecord(values: Record<string, unknown> = { name: 'a' }): PersistedFormHistory {
  return { version: 1, savedAt: 123, values, history: { past: [], future: [] } as never };
}

describe('createIndexedDbStorage', () => {
  it('should resolve undefined when loading a key that was never saved', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });

    await expect(storage.load('missing')).resolves.toBeUndefined();
  });

  it('should return the saved record when loading after save', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });
    const record = makeRecord();

    await storage.save('k', record);

    await expect(storage.load('k')).resolves.toEqual(record);
  });

  it('should keep only the latest record when saving the same key twice', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });

    await storage.save('k', makeRecord({ name: 'first' }));
    await storage.save('k', makeRecord({ name: 'second' }));

    expect((await storage.load('k'))?.values).toEqual({ name: 'second' });
  });

  it('should resolve undefined when loading a removed key', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });
    await storage.save('k', makeRecord());

    await storage.remove('k');

    await expect(storage.load('k')).resolves.toBeUndefined();
  });

  it('should not throw when removing a key that does not exist', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });

    await expect(storage.remove('nope')).resolves.toBeUndefined();
  });

  it('should isolate records when different keys are used', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });
    await storage.save('a', makeRecord({ n: 'A' }));
    await storage.save('b', makeRecord({ n: 'B' }));

    await storage.remove('a');

    await expect(storage.load('a')).resolves.toBeUndefined();
    expect((await storage.load('b'))?.values).toEqual({ n: 'B' });
  });

  it('should preserve Date, Map and nested values when roundtripping via structured clone', async () => {
    const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });
    const date = new Date('2024-05-06T07:08:09Z');
    const values = { when: date, tags: new Map([['x', { deep: [1, 2, { z: date }] }]]) };

    await storage.save('k', makeRecord(values));
    const loaded = await storage.load('k');

    const loadedValues = loaded?.values as typeof values;
    expect(loadedValues.when).toBeInstanceOf(Date);
    expect(loadedValues.when.getTime()).toBe(date.getTime());
    expect(loadedValues.tags).toBeInstanceOf(Map);
    expect(loadedValues.tags.get('x')).toEqual({ deep: [1, 2, { z: date }] });
  });

  it('should see the same data when two storages share a factory and dbName', async () => {
    const indexedDB = new IDBFactory();
    const one = createIndexedDbStorage({ indexedDB });
    const two = createIndexedDbStorage({ indexedDB });

    await one.save('k', makeRecord({ shared: true }));

    expect((await two.load('k'))?.values).toEqual({ shared: true });
  });

  it('should not share data when storages use different factories', async () => {
    const one = createIndexedDbStorage({ indexedDB: new IDBFactory() });
    const two = createIndexedDbStorage({ indexedDB: new IDBFactory() });

    await one.save('k', makeRecord());

    await expect(two.load('k')).resolves.toBeUndefined();
  });

  it('should isolate data when dbName differs on a shared factory', async () => {
    const indexedDB = new IDBFactory();
    const one = createIndexedDbStorage({ indexedDB, dbName: 'db-one' });
    const two = createIndexedDbStorage({ indexedDB, dbName: 'db-two' });

    await one.save('k', makeRecord());

    await expect(two.load('k')).resolves.toBeUndefined();
    await expect(one.load('k')).resolves.toBeDefined();
  });

  it('should create the object store with the custom storeName when provided', async () => {
    const indexedDB = new IDBFactory();
    const storage = createIndexedDbStorage({ indexedDB, dbName: 'custom', storeName: 'my-store' });
    await storage.save('k', makeRecord());

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('custom');
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });

    expect(Array.from(db.objectStoreNames)).toEqual(['meta', 'my-store']);
    db.close();
  });

  it('should reject with a clear error when indexedDB is not available', async () => {
    const storage = createIndexedDbStorage({ indexedDB: undefined as never });

    await expect(storage.load('k')).rejects.toThrow('IndexedDB is not available');
    await expect(storage.save('k', makeRecord())).rejects.toThrow('IndexedDB is not available');
    await expect(storage.remove('k')).rejects.toThrow('IndexedDB is not available');
  });

  it('should reject with a clear error when relying on the default and globalThis.indexedDB is missing', async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const storage = createIndexedDbStorage();

    await expect(storage.load('k')).rejects.toThrow('IndexedDB is not available');
  });

  it('should work again when a previous open failed', async () => {
    const real = new IDBFactory();
    let failures = 1;
    const flaky = {
      open: (name: string, version?: number) => {
        if (failures-- > 0) {
          const request = {} as IDBOpenDBRequest;
          queueMicrotask(() => {
            Object.defineProperty(request, 'error', { value: new Error('boom') });
            request.onerror?.(new Event('error'));
          });
          return request;
        }
        return real.open(name, version);
      },
    } as unknown as IDBFactory;
    const storage = createIndexedDbStorage({ indexedDB: flaky });

    await expect(storage.load('k')).rejects.toThrow('boom');
    await storage.save('k', makeRecord({ ok: 1 }));

    expect((await storage.load('k'))?.values).toEqual({ ok: 1 });
  });

  it('should reject instead of hanging when a v3 database has no meta store', async () => {
    const indexedDB = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('form-history', 3);
      request.onupgradeneeded = (): void => {
        request.result.createObjectStore('histories');
      };
      request.onsuccess = (): void => {
        request.result.close();
        resolve();
      };
      request.onerror = (): void => reject(request.error);
    });
    const storage = createIndexedDbStorage({ indexedDB });

    await expect(storage.load('k')).rejects.toThrow(
      expect.objectContaining({ name: 'NotFoundError' }),
    );
  });

  describe('clearing across tabs', () => {
    it('should reject save with DraftsClearedError and not recreate the record when another instance cleared', async () => {
      const indexedDB = new IDBFactory();
      const tabA = createIndexedDbStorage({ indexedDB });
      const tabB = createIndexedDbStorage({ indexedDB });
      await tabA.save('k', makeRecord({ n: 'old' }));
      await tabB.load('k');

      await tabB.clearAll();

      await expect(tabA.save('k', makeRecord({ n: 'stale' }))).rejects.toBeInstanceOf(
        DraftsClearedError,
      );
      await expect(tabB.load('k')).resolves.toBeUndefined();
    });

    it('should keep saving when the same instance cleared', async () => {
      const indexedDB = new IDBFactory();
      const tabA = createIndexedDbStorage({ indexedDB });
      const tabB = createIndexedDbStorage({ indexedDB });
      await tabA.load('k');
      await tabB.load('k');

      await tabB.clearAll();
      await tabB.save('k', makeRecord({ n: 'fresh' }));
      await tabB.clearAll();
      await tabB.save('k', makeRecord({ n: 'fresher' }));

      expect((await tabB.load('k'))?.values).toEqual({ n: 'fresher' });
    });

    it('should still allow load and remove when another instance cleared', async () => {
      const indexedDB = new IDBFactory();
      const tabA = createIndexedDbStorage({ indexedDB });
      const tabB = createIndexedDbStorage({ indexedDB });
      await tabA.load('k');
      await tabB.clearAll();
      await tabB.save('k', makeRecord({ n: 'b' }));

      expect((await tabA.load('k'))?.values).toEqual({ n: 'b' });
      await expect(tabA.remove('k')).resolves.toBeUndefined();
      await expect(tabA.load('k')).resolves.toBeUndefined();
    });

    it('should adopt the current epoch when an instance first opens after a clear', async () => {
      const indexedDB = new IDBFactory();
      await createIndexedDbStorage({ indexedDB }).clearAll();
      const late = createIndexedDbStorage({ indexedDB });

      await late.save('k', makeRecord());

      await expect(late.load('k')).resolves.toEqual(makeRecord());
    });
  });

  describe('schema upgrade', () => {
    const openRaw = (
      indexedDB: IDBFactory,
      name: string,
      version: number,
      upgrade?: (db: IDBDatabase) => void,
    ): Promise<IDBDatabase> =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = (): void => upgrade?.(request.result);
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
      });

    it('should expire pre-existing records when upgrading from a v1 database without the savedAt index', async () => {
      const indexedDB = new IDBFactory();
      const v1 = await openRaw(
        indexedDB,
        'form-history',
        1,
        (db) => void db.createObjectStore('histories'),
      );
      await new Promise<void>((resolve, reject) => {
        const tx = v1.transaction('histories', 'readwrite');
        tx.objectStore('histories').put({ ...makeRecord({ old: true }), savedAt: 10 }, 'old');
        tx.objectStore('histories').put({ ...makeRecord({ fresh: true }), savedAt: 900 }, 'fresh');
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error);
      });
      v1.close();
      const storage = createIndexedDbStorage({ indexedDB });

      const removed = await storage.removeOlderThan(500);

      expect(removed).toBe(1);
      await expect(storage.load('old')).resolves.toBeUndefined();
      expect((await storage.load('fresh'))?.values).toEqual({ fresh: true });
    });

    it('should create the savedAt index when opening a fresh database', async () => {
      const indexedDB = new IDBFactory();
      const storage = createIndexedDbStorage({ indexedDB });
      await storage.save('k', makeRecord());

      const db = await openRaw(indexedDB, 'form-history', 3);

      expect(db.version).toBe(3);
      expect(
        db.transaction('histories').objectStore('histories').indexNames.contains('savedAt'),
      ).toBe(true);
      db.close();
    });

    it('should add the savedAt index to the existing store when upgrading from v1', async () => {
      const indexedDB = new IDBFactory();
      const v1 = await openRaw(
        indexedDB,
        'form-history',
        1,
        (db) => void db.createObjectStore('histories'),
      );
      v1.close();
      await createIndexedDbStorage({ indexedDB }).load('k');

      const db = await openRaw(indexedDB, 'form-history', 3);

      expect(
        db.transaction('histories').objectStore('histories').indexNames.contains('savedAt'),
      ).toBe(true);
      db.close();
    });

    it('should keep existing records when upgrading from v2 to v3', async () => {
      const indexedDB = new IDBFactory();
      const v2 = await openRaw(indexedDB, 'form-history', 2, (db) => {
        db.createObjectStore('histories').createIndex('savedAt', 'savedAt');
      });
      await new Promise<void>((resolve, reject) => {
        const tx = v2.transaction('histories', 'readwrite');
        tx.objectStore('histories').put(makeRecord({ kept: true }), 'k');
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error);
      });
      v2.close();
      const storage = createIndexedDbStorage({ indexedDB });

      expect((await storage.load('k'))?.values).toEqual({ kept: true });
      await storage.save('k', makeRecord({ kept: 'again' }));

      const db = await openRaw(indexedDB, 'form-history', 3);
      expect(db.objectStoreNames.contains('meta')).toBe(true);
      db.close();
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, type PersistedFormHistory } from './storage';
import { removeExpiredDrafts } from './sweep';

function makeRecord(savedAt: number): PersistedFormHistory {
  return { version: 1, savedAt, values: {}, history: { past: [], future: [] } as never };
}

describe('removeExpiredDrafts', () => {
  it('should call removeOlderThan with now minus maxAgeMs when sweeping', async () => {
    const storage = createMemoryStorage();
    const spy = vi.spyOn(storage, 'removeOlderThan');

    await removeExpiredDrafts(storage, 1000, () => 5000);

    expect(spy).toHaveBeenCalledExactlyOnceWith(4000);
  });

  it('should return the number of removed drafts when some are expired', async () => {
    const storage = createMemoryStorage();
    await storage.save('a', makeRecord(100));
    await storage.save('b', makeRecord(3999));
    await storage.save('c', makeRecord(4000));
    await storage.save('d', makeRecord(4500));

    const removed = await removeExpiredDrafts(storage, 1000, () => 5000);

    expect(removed).toBe(2);
    await expect(storage.load('a')).resolves.toBeUndefined();
    await expect(storage.load('b')).resolves.toBeUndefined();
    await expect(storage.load('c')).resolves.toBeDefined();
    await expect(storage.load('d')).resolves.toBeDefined();
  });

  it('should return 0 when no drafts are expired', async () => {
    const storage = createMemoryStorage();
    await storage.save('a', makeRecord(4900));

    await expect(removeExpiredDrafts(storage, 1000, () => 5000)).resolves.toBe(0);
  });

  it('should return 0 when storage is empty', async () => {
    await expect(removeExpiredDrafts(createMemoryStorage(), 1000, () => 5000)).resolves.toBe(0);
  });

  it('should use Date.now when no clock is injected', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const storage = createMemoryStorage();
    const spy = vi.spyOn(storage, 'removeOlderThan');

    await removeExpiredDrafts(storage, 4000);

    expect(spy).toHaveBeenCalledWith(6000);
    vi.restoreAllMocks();
  });
});

import { createFormHistoryStore, type FormHistoryStore } from '@yoo-digital/rhf-history';
import { canUndo, createHistory, diff } from '@yoo-digital/rhf-history/core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createFormControl, type FieldValues } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createIndexedDbStorage } from './indexedDbStorage';
import {
  persistFormHistory,
  type FormHistoryPersistence,
  type PersistOptions,
  type RecoveryCandidate,
} from './persistFormHistory';
import {
  createMemoryStorage,
  DraftsClearedError,
  RecoveryUnavailableError,
  type FormHistoryStorage,
  type PersistedFormHistory,
  type RevisionKey,
} from './storage';

const KEY = 'form:1';
const VERSION = 1;
const DEBOUNCE = 300;

type TestForm = {
  form: ReturnType<typeof createFormControl<Record<string, string>>>['formControl'];
  store: FormHistoryStore;
  disconnect: () => void;
};

type SpyStorage = { [K in keyof FormHistoryStorage]: Mock<FormHistoryStorage[K]> };

function createForm(defaults: Record<string, string> = { a: '', b: '' }): TestForm {
  const { formControl } = createFormControl({ defaultValues: defaults });
  for (const name of Object.keys(defaults)) formControl.register(name);
  const store = createFormHistoryStore(formControl);
  const disconnect = store.connect();
  return { form: formControl, store, disconnect };
}

/** Builds a persisted record by editing a throwaway form twice. */
function makeSavedRecord(version = VERSION, savedAt = 1): PersistedFormHistory {
  const { form, store } = createForm();
  form.setValue('a', 'one');
  form.setValue('b', 'two');
  return { version, savedAt, values: form.getValues(), history: store.getHistory() };
}

function spyStorage(base: FormHistoryStorage = createMemoryStorage()): SpyStorage {
  return {
    load: vi.fn<FormHistoryStorage['load']>(base.load),
    save: vi.fn<FormHistoryStorage['save']>(base.save),
    remove: vi.fn<FormHistoryStorage['remove']>(base.remove),
    clearAll: vi.fn<FormHistoryStorage['clearAll']>(base.clearAll),
    removeOlderThan: vi.fn<FormHistoryStorage['removeOlderThan']>(base.removeOlderThan),
    listRevisions: vi.fn<FormHistoryStorage['listRevisions']>(base.listRevisions),
    removeRevisions: vi.fn<FormHistoryStorage['removeRevisions']>(base.removeRevisions),
  } satisfies FormHistoryStorage;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('persistFormHistory', () => {
  let persistence: FormHistoryPersistence | undefined;

  function start(
    form: TestForm,
    options: Partial<PersistOptions> & { storage: FormHistoryStorage },
  ): FormHistoryPersistence {
    persistence = persistFormHistory(form.form, form.store, {
      key: KEY,
      version: VERSION,
      debounceMs: DEBOUNCE,
      ...options,
    });
    return persistence;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    persistence?.dispose();
    persistence = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('restoring', () => {
    it('should restore values and history when a valid record exists', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord());
      const target = createForm();

      const { restored } = start(target, { storage });

      await expect(restored).resolves.toBe(true);
      expect(target.form.getValues()).toEqual({ a: 'one', b: 'two' });
      expect(target.store.getState().undoCount).toBe(2);
    });

    it('should return to the earlier value when undoing after a restore', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord());
      const target = createForm();
      await start(target, { storage }).restored;

      target.store.undo();

      expect(target.form.getValues('b')).toBe('');
      expect(target.form.getValues('a')).toBe('one');
      expect(target.store.getState().redoCount).toBe(1);
    });

    it('should resolve restored with false when no record exists', async () => {
      const target = createForm();

      const { restored } = start(target, { storage: spyStorage() });

      await expect(restored).resolves.toBe(false);
      expect(target.store.getState().undoCount).toBe(0);
    });

    it('should discard and remove the record when the version differs', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION + 1));
      const target = createForm();

      const { restored } = start(target, { storage });

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(await storage.load(KEY)).toBeUndefined();
      expect(target.form.getValues()).toEqual({ a: '', b: '' });
    });

    it('should discard and remove the record when validate returns false', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord());
      const validate = vi.fn<(values: FieldValues) => boolean>(() => false);
      const target = createForm();

      const { restored } = start(target, { storage, validate });

      await expect(restored).resolves.toBe(false);
      expect(validate).toHaveBeenCalledWith({ a: 'one', b: 'two' });
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(target.form.getValues()).toEqual({ a: '', b: '' });
    });

    it('should discard and remove the record when savedAt is not a number', async () => {
      const storage = spyStorage();
      await storage.save(KEY, { ...makeSavedRecord(), savedAt: Number.NaN });
      const target = createForm();

      const { restored } = start(target, { storage, maxAgeMs: 1000, now: () => 10_000 });

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(target.form.getValues()).toEqual({ a: '', b: '' });
    });

    it('should discard the record and keep recording when the history is malformed', async () => {
      const storage = spyStorage();
      const record = makeSavedRecord();
      await storage.save(KEY, {
        ...record,
        history: { ...record.history, past: undefined } as never,
      });
      const target = createForm();

      const { restored } = start(target, { storage });

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      target.form.setValue('a', 'edited');
      expect(target.store.getState().undoCount).toBe(1);
    });

    it('should discard the record without polluting Object.prototype when a patch path targets __proto__', async () => {
      const storage = spyStorage();
      const record = makeSavedRecord();
      const patch = { path: '__proto__.polluted', before: 'yes', after: 'yes' };
      await storage.save(KEY, {
        ...record,
        history: { ...record.history, past: [{ patches: [patch] }] },
      });
      const target = createForm();

      const { restored } = start(target, { storage });
      target.store.undo();

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should not pollute Object.prototype when undoing a restored __proto__ patch', () => {
      // Defence in depth below the record check: react-hook-form's set() must ignore the path.
      const target = createForm();
      const patch = { path: '__proto__.polluted', before: 'yes', after: 'yes' };
      target.store.restore({
        values: { a: '', b: '' },
        history: { past: [{ patches: [patch] }], future: [], group: null, updatedAt: 0 },
      });

      target.store.undo();
      target.store.redo();

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should not restore when the user edited before load resolved', async () => {
      const gate = deferred<PersistedFormHistory | undefined>();
      const storage = spyStorage();
      storage.load.mockReturnValue(gate.promise);
      const target = createForm();
      const { restored } = start(target, { storage });

      target.form.setValue('a', 'typed');
      gate.resolve(makeSavedRecord());

      await expect(restored).resolves.toBe(false);
      expect(target.form.getValues()).toEqual({ a: 'typed', b: '' });
      expect(target.store.getState().undoCount).toBe(1);
    });

    it('should save the user edits after the restore attempt finished when edits happened during load', async () => {
      const gate = deferred<PersistedFormHistory | undefined>();
      const storage = spyStorage();
      storage.load.mockReturnValue(gate.promise);
      const target = createForm();
      const { restored } = start(target, { storage });
      target.form.setValue('a', 'typed');

      gate.resolve(makeSavedRecord());
      await restored;
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(storage.save.mock.calls[0][1].values).toEqual({ a: 'typed', b: '' });
    });

    it('should report load errors to onError and resolve false when load rejects', async () => {
      const error = new Error('load failed');
      const storage = spyStorage();
      storage.load.mockRejectedValue(error);
      const onError = vi.fn<(error: unknown) => void>();

      const { restored } = start(createForm(), { storage, onError });

      await expect(restored).resolves.toBe(false);
      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('expiry', () => {
    const MAX_AGE = 1000;
    const NOW = 10_000;

    it('should not restore and should remove the record when it is older than maxAgeMs', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, NOW - MAX_AGE - 1));
      const target = createForm();

      const { restored } = start(target, { storage, maxAgeMs: MAX_AGE, now: () => NOW });

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(await storage.load(KEY)).toBeUndefined();
      expect(target.form.getValues()).toEqual({ a: '', b: '' });
      expect(target.store.getState().undoCount).toBe(0);
    });

    it('should remove an expired record when the user edited before load resolved', async () => {
      const gate = deferred<PersistedFormHistory | undefined>();
      const storage = spyStorage();
      storage.load.mockReturnValue(gate.promise);
      const target = createForm();
      const { restored } = start(target, { storage, maxAgeMs: MAX_AGE, now: () => NOW });

      target.form.setValue('a', 'typed');
      gate.resolve(makeSavedRecord(VERSION, NOW - MAX_AGE - 1));

      await expect(restored).resolves.toBe(false);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(target.form.getValues()).toEqual({ a: 'typed', b: '' });
    });

    it('should restore when the record is exactly maxAgeMs old', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, NOW - MAX_AGE));
      const target = createForm();

      const { restored } = start(target, { storage, maxAgeMs: MAX_AGE, now: () => NOW });

      await expect(restored).resolves.toBe(true);
      expect(storage.remove).not.toHaveBeenCalled();
      expect(target.form.getValues()).toEqual({ a: 'one', b: 'two' });
    });

    it('should restore when the record is younger than maxAgeMs', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, NOW - 1));
      const target = createForm();

      const { restored } = start(target, { storage, maxAgeMs: MAX_AGE, now: () => NOW });

      await expect(restored).resolves.toBe(true);
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('should restore a very old record when maxAgeMs is not set', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, 0));
      const target = createForm();

      const { restored } = start(target, { storage, now: () => Number.MAX_SAFE_INTEGER });

      await expect(restored).resolves.toBe(true);
      expect(storage.remove).not.toHaveBeenCalled();
      expect(target.form.getValues()).toEqual({ a: 'one', b: 'two' });
    });

    it('should treat maxAgeMs of 0 as expiring any record saved before now', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, NOW - 1));

      const { restored } = start(createForm(), { storage, maxAgeMs: 0, now: () => NOW });

      await expect(restored).resolves.toBe(false);
      expect(await storage.load(KEY)).toBeUndefined();
    });

    it('should not call validate when the record is expired', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord(VERSION, 0));
      const validate = vi.fn<(values: FieldValues) => boolean>(() => true);

      await start(createForm(), { storage, maxAgeMs: MAX_AGE, now: () => NOW, validate }).restored;

      expect(validate).not.toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    it('should save only after debounceMs has elapsed when a change happens', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage }).restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
      expect(storage.save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(storage.save).toHaveBeenCalledTimes(1);
      const [key, record] = storage.save.mock.calls[0];
      expect(key).toBe(KEY);
      expect(record.version).toBe(VERSION);
      expect(record.values).toEqual({ a: 'x', b: '' });
      expect(record.history.past).toHaveLength(1);
    });

    it('should write a single record when several changes happen within the debounce window', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage }).restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(100);
      target.form.setValue('b', 'y');
      await vi.advanceTimersByTimeAsync(100);
      target.form.setValue('a', 'z');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(storage.save.mock.calls[0][1].values).toEqual({ a: 'z', b: 'y' });
    });

    it('should use the injected now for savedAt', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage, now: () => 4242 }).restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save.mock.calls[0][1].savedAt).toBe(4242);
    });

    it('should not save before the restore finished when changes happen while loading', async () => {
      const gate = deferred<PersistedFormHistory | undefined>();
      const storage = spyStorage();
      storage.load.mockReturnValue(gate.promise);
      const target = createForm();
      start(target, { storage });

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
      void persistence!.flush();
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.save).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('should write immediately when flush is called', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;
      target.form.setValue('a', 'x');

      await p.flush();

      expect(storage.save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
      expect(storage.save).toHaveBeenCalledTimes(1);
    });

    it('should not write when flush is called without pending changes', async () => {
      const storage = spyStorage();
      const p = start(createForm(), { storage });
      await p.restored;

      await p.flush();

      expect(storage.save).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('should remove the record instead of saving when the history is empty', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage }).restored;
      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
      expect(storage.save).toHaveBeenCalledTimes(1);

      target.store.clear();
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(await storage.load(KEY)).toBeUndefined();
    });

    it('should report save errors to onError without throwing when save rejects', async () => {
      const error = new Error('quota');
      const storage = spyStorage();
      storage.save.mockRejectedValue(error);
      const onError = vi.fn<(error: unknown) => void>();
      const target = createForm();
      const p = start(target, { storage, onError });
      await p.restored;
      target.form.setValue('a', 'x');

      await expect(p.flush()).resolves.toBeUndefined();

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should keep saving later changes when an earlier save failed', async () => {
      const storage = spyStorage();
      storage.save.mockRejectedValueOnce(new Error('once'));
      const target = createForm();
      const p = start(target, { storage, onError: vi.fn<(error: unknown) => void>() });
      await p.restored;
      target.form.setValue('a', 'x');
      await p.flush();

      target.form.setValue('b', 'y');
      await p.flush();

      expect(storage.save).toHaveBeenCalledTimes(2);
    });

    it('should write immediately when the document becomes hidden', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage }).restored;
      target.form.setValue('a', 'x');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.save).toHaveBeenCalledTimes(1);
    });

    it('should not write when the document becomes visible', async () => {
      const storage = spyStorage();
      const target = createForm();
      await start(target, { storage }).restored;
      target.form.setValue('a', 'x');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('cleared by another tab', () => {
    it('should stop saving and not call onError when a save rejects with DraftsClearedError', async () => {
      const storage = spyStorage();
      storage.save.mockRejectedValueOnce(new DraftsClearedError());
      const onError = vi.fn<(error: unknown) => void>();
      const target = createForm();
      const p = start(target, { storage, onError });
      await p.restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
      target.form.setValue('a', 'y');
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
      await p.flush();
      p.dispose();
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should keep saving and report the error when a save rejects with another error', async () => {
      const storage = spyStorage();
      const failure = new Error('quota');
      storage.save.mockRejectedValueOnce(failure);
      const onError = vi.fn<(error: unknown) => void>();
      const target = createForm();
      await start(target, { storage, onError }).restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
      target.form.setValue('a', 'y');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(onError).toHaveBeenCalledWith(failure);
      expect(storage.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('should remove the record when clear is called', async () => {
      const storage = spyStorage();
      await storage.save(KEY, makeSavedRecord());
      const p = start(createForm(), { storage });
      await p.restored;
      storage.remove.mockClear();

      await p.clear();

      expect(storage.remove).toHaveBeenCalledWith(KEY);
      expect(await storage.load(KEY)).toBeUndefined();
    });

    it('should cancel the pending save when clear is called', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;
      target.form.setValue('a', 'x');

      await p.clear();
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);

      expect(storage.save).not.toHaveBeenCalled();
      expect(storage.remove).toHaveBeenCalledWith(KEY);
    });
  });

  describe('revision keys', () => {
    const REV = { scope: 'u1', document: 'doc', revision: 'r2' };

    it('should write the captured base on save when the key is a revision key', async () => {
      const storage = spyStorage();
      const target = createForm({ a: 'server', b: '' });
      const p = start(target, { storage, key: REV });
      await p.restored;

      target.form.setValue('a', 'edited');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect((await storage.load(REV))?.base).toEqual({ a: 'server', b: '' });
    });

    it('should capture the base before loading when edits happen during the load', async () => {
      const gate = deferred<void>();
      const storage = spyStorage();
      const load = storage.load;
      storage.load = vi.fn<FormHistoryStorage['load']>(
        async (key) => (await gate.promise, load(key)),
      );
      const target = createForm({ a: 'server', b: '' });
      const p = start(target, { storage, key: REV });

      target.form.setValue('a', 'early');
      gate.resolve();
      await p.restored;
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect((await storage.load(REV))?.base).toEqual({ a: 'server', b: '' });
    });

    it('should adopt the stored base when the exact draft is restored', async () => {
      const storage = spyStorage();
      await storage.save(REV, { ...makeSavedRecord(), base: { a: 'old-base', b: '' } });
      const target = createForm({ a: 'server', b: '' });
      const p = start(target, { storage, key: REV });
      await expect(p.restored).resolves.toBe(true);

      target.form.setValue('a', 'more');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect((await storage.load(REV))?.base).toEqual({ a: 'old-base', b: '' });
    });

    it('should keep the captured base when the restored record has none', async () => {
      const storage = spyStorage();
      await storage.save(REV, makeSavedRecord());
      const target = createForm({ a: 'server', b: '' });
      const p = start(target, { storage, key: REV });
      await p.restored;

      target.form.setValue('a', 'more');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect((await storage.load(REV))?.base).toEqual({ a: 'server', b: '' });
    });

    it('should not write base when the key is a string', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      const saved = await storage.load(KEY);
      expect(saved).toBeDefined();
      expect(saved).not.toHaveProperty('base');
    });

    it('should remove every revision of the document when clear is called', async () => {
      const storage = spyStorage();
      await storage.save(REV, makeSavedRecord());
      await storage.save({ ...REV, revision: 'r1' }, makeSavedRecord());
      await storage.save({ ...REV, document: 'other' }, makeSavedRecord());
      const p = start(createForm(), { storage, key: REV });
      await p.restored;

      await p.clear();

      expect(storage.removeRevisions).toHaveBeenCalledWith('u1', 'doc');
      expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
      expect(await storage.listRevisions('u1', 'other')).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should flush pending changes when disposed', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;
      target.form.setValue('a', 'x');

      p.dispose();
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(storage.save.mock.calls[0][1].values).toEqual({ a: 'x', b: '' });
    });

    it('should stop listening to changes when disposed', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;
      p.dispose();

      target.form.setValue('a', 'x');
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);

      expect(storage.save).not.toHaveBeenCalled();
    });

    it('should stop reacting to visibilitychange when disposed', async () => {
      const storage = spyStorage();
      const target = createForm();
      const p = start(target, { storage });
      await p.restored;
      p.dispose();
      target.form.setValue('a', 'x');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.save).not.toHaveBeenCalled();
    });

    it('should not restore when disposed before load resolved', async () => {
      const gate = deferred<PersistedFormHistory | undefined>();
      const storage = spyStorage();
      storage.load.mockReturnValue(gate.promise);
      const target = createForm();
      const p = start(target, { storage });

      p.dispose();
      gate.resolve(makeSavedRecord());

      await expect(p.restored).resolves.toBe(false);
      expect(target.form.getValues()).toEqual({ a: '', b: '' });
    });
  });

  describe('recovery candidate', () => {
    const REV = { scope: 'u1', document: 'doc', revision: 'r2' };
    const stale = (revision: string, document = 'doc', scope = 'u1'): RevisionKey => ({
      scope,
      document,
      revision,
    });
    const SERVER = { a: 'server', b: '' };

    /** A draft saved for an older revision: base `{ a: 'old', b: '' }` plus one edit of `b`. */
    function staleDraft(overrides: Partial<PersistedFormHistory> = {}): PersistedFormHistory {
      const base = { a: 'old', b: '' };
      const values = { a: 'old', b: 'mine' };
      const history = { ...createHistory(), past: [{ patches: diff(base, values) }] };
      return { version: VERSION, savedAt: 1, base, values, history, ...overrides };
    }

    it('should report the stale draft as candidate when no exact draft exists', async () => {
      const storage = spyStorage();
      await storage.save(stale('r1'), staleDraft({ savedAt: 5 }));
      const target = createForm(SERVER);

      const p = start(target, { storage, key: REV });

      await expect(p.restored).resolves.toBe(false);
      const candidate = await p.candidate;
      expect(candidate).toMatchObject({ revision: 'r1', savedAt: 5 });
      expect(target.form.getValues()).toEqual(SERVER);
      expect(canUndo(target.store.getHistory())).toBe(false);
    });

    it('should report the newest stale draft when several exist', async () => {
      const storage = spyStorage();
      await storage.save(stale('r0'), staleDraft({ savedAt: 1 }));
      await storage.save(stale('r1'), staleDraft({ savedAt: 9 }));
      await storage.save(stale('r3'), staleDraft({ savedAt: 4 }));

      const p = start(createForm(SERVER), { storage, key: REV });

      expect((await p.candidate)?.revision).toBe('r1');
    });

    it('should resolve null when no stale draft exists', async () => {
      const p = start(createForm(SERVER), { storage: spyStorage(), key: REV });

      await expect(p.candidate).resolves.toBeNull();
    });

    it('should resolve null without touching storage listings when the key is a string', async () => {
      const storage = spyStorage();
      await storage.save(stale('r1'), staleDraft());

      const p = start(createForm(SERVER), { storage });

      await expect(p.candidate).resolves.toBeNull();
      expect(storage.listRevisions).not.toHaveBeenCalled();
      expect(storage.removeRevisions).not.toHaveBeenCalled();
    });

    it('should not report drafts of other documents or scopes when the document id is a prefix', async () => {
      const storage = spyStorage();
      await storage.save(stale('r1', 'doc-2'), staleDraft());
      await storage.save(stale('r1', 'do'), staleDraft());
      await storage.save(stale('r1', 'doc', 'u2'), staleDraft());

      const p = start(createForm(SERVER), { storage, key: REV });

      await expect(p.candidate).resolves.toBeNull();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('should not report a candidate when the exact draft is restored', async () => {
      const storage = spyStorage();
      await storage.save(REV, { ...makeSavedRecord(), base: SERVER });
      await storage.save(stale('r1'), staleDraft());

      const p = start(createForm(SERVER), { storage, key: REV });

      await expect(p.restored).resolves.toBe(true);
      await expect(p.candidate).resolves.toBeNull();
      expect(storage.listRevisions).not.toHaveBeenCalled();
    });

    it.each([
      ['expired', { savedAt: -1_000 }, { maxAgeMs: 10 }],
      ['of another version', { version: VERSION + 1 }, {}],
      ['malformed', { savedAt: Number.NaN }, {}],
      ['without base', { base: undefined }, {}],
    ] as const)(
      'should delete the stale draft and report no candidate when it is %s',
      async (_name, overrides, options) => {
        const storage = spyStorage();
        await storage.save(stale('r1'), staleDraft(overrides));

        const p = start(createForm(SERVER), { storage, key: REV, now: () => 0, ...options });

        await expect(p.candidate).resolves.toBeNull();
        expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
      },
    );

    it('should skip an unusable newer draft and report the next usable one when it is deleted', async () => {
      const storage = spyStorage();
      await storage.save(stale('r1'), staleDraft({ savedAt: 3 }));
      await storage.save(stale('r0'), staleDraft({ savedAt: 9, version: VERSION + 1 }));

      const p = start(createForm(SERVER), { storage, key: REV });

      expect((await p.candidate)?.revision).toBe('r1');
      expect(await storage.listRevisions('u1', 'doc')).toEqual([{ revision: 'r1', savedAt: 3 }]);
    });

    it('should delete the stale draft without polluting Object.prototype when its values have a __proto__ key', async () => {
      const storage = spyStorage();
      const values = JSON.parse('{"a":"old","b":"","__proto__":{"polluted":true}}');
      await storage.save(stale('r1'), staleDraft({ values }));

      const p = start(createForm(SERVER), { storage, key: REV });

      await expect(p.candidate).resolves.toBeNull();
      expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should still report the candidate when the user edited before detection finished', async () => {
      const gate = deferred<void>();
      const storage = spyStorage();
      await storage.save(stale('r1'), staleDraft());
      const listRevisions = storage.listRevisions;
      storage.listRevisions = vi.fn<FormHistoryStorage['listRevisions']>(
        async (scope, document) => (await gate.promise, listRevisions(scope, document)),
      );
      const target = createForm(SERVER);
      const p = start(target, { storage, key: REV });

      target.form.setValue('a', 'early');
      gate.resolve();

      expect((await p.candidate)?.revision).toBe('r1');
      expect(target.form.getValues().a).toBe('early');
    });

    it('should report listing errors to onError and resolve null when listRevisions rejects', async () => {
      const storage = spyStorage();
      storage.listRevisions = vi
        .fn<FormHistoryStorage['listRevisions']>()
        .mockRejectedValue(new Error('list failed'));
      const onError = vi.fn<(error: unknown) => void>();

      const p = start(createForm(SERVER), { storage, key: REV, onError });

      await expect(p.candidate).resolves.toBeNull();
      await expect(p.restored).resolves.toBe(false);
      expect(onError).toHaveBeenCalledWith(new Error('list failed'));
    });

    it('should restore the exact draft and ignore listing failures when the exact draft exists', async () => {
      const storage = spyStorage();
      storage.listRevisions = vi
        .fn<FormHistoryStorage['listRevisions']>()
        .mockRejectedValue(new Error('list failed'));
      await storage.save(REV, { ...makeSavedRecord(), base: SERVER });
      const onError = vi.fn<(error: unknown) => void>();

      const p = start(createForm(SERVER), { storage, key: REV, onError });

      await expect(p.restored).resolves.toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should not save before detection finished when changes happen while listing', async () => {
      const gate = deferred<void>();
      const storage = spyStorage();
      const listRevisions = storage.listRevisions;
      storage.listRevisions = vi.fn<FormHistoryStorage['listRevisions']>(
        async (scope, document) => (await gate.promise, listRevisions(scope, document)),
      );
      const target = createForm(SERVER);
      const p = start(target, { storage, key: REV });

      target.form.setValue('a', 'early');
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
      expect(storage.save).not.toHaveBeenCalled();

      gate.resolve();
      await p.candidate;
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      expect(storage.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('recovery settling', () => {
    const REV = { scope: 'u1', document: 'doc', revision: 'r2' };
    const STALE = { ...REV, revision: 'r1' };
    const OLD = { a: 'old', b: '', c: 'c' };

    function staleDraft(
      values: Record<string, string>,
      overrides: Partial<PersistedFormHistory> = {},
    ): PersistedFormHistory {
      const history = { ...createHistory(), past: [{ patches: diff(OLD, values) }] };
      return {
        version: VERSION,
        savedAt: 1,
        base: OLD,
        values,
        history,
        ...overrides,
      } satisfies PersistedFormHistory;
    }

    const instances: FormHistoryPersistence[] = [];
    afterEach(() => {
      instances.splice(0).forEach((instance) => instance.dispose());
    });

    /** Server moved `a` on; the draft edited `b` (and optionally `a`). */
    async function open(
      draft: PersistedFormHistory = staleDraft({ ...OLD, b: 'mine' }),
      {
        storage = spyStorage(),
        server = { ...OLD, a: 'server' },
        ...options
      }: Omit<Partial<PersistOptions>, 'storage'> & {
        storage?: SpyStorage;
        server?: Record<string, string>;
      } = {},
    ): Promise<{
      storage: SpyStorage;
      target: TestForm;
      p: FormHistoryPersistence;
      candidate: RecoveryCandidate;
    }> {
      await storage.save(STALE, draft);
      const target = createForm(server);
      const p = persistFormHistory(target.form, target.store, {
        key: REV,
        version: VERSION,
        debounceMs: DEBOUNCE,
        storage,
        ...options,
      });
      instances.push(p);
      const candidate = await p.candidate;
      if (!candidate) throw new Error('expected a candidate');
      return { storage, target, p, candidate };
    }

    it('should merge own changes onto the current values when previewing', async () => {
      const { candidate } = await open();

      const preview = candidate.preview();

      expect(preview.merged).toEqual({ a: 'server', b: 'mine', c: 'c' });
      expect(preview.applied).toEqual([{ path: 'b', before: '', after: 'mine' }]);
      expect(preview.conflicts).toEqual([]);
      expect(preview.valid).toBe(true);
    });

    it('should not change the form, history or storage when previewing', async () => {
      const { candidate, target, storage } = await open();
      const history = target.store.getHistory();
      vi.clearAllMocks();

      candidate.preview();
      candidate.preview({ a: 'mine' });

      expect(target.form.getValues()).toEqual({ ...OLD, a: 'server' });
      expect(target.store.getHistory()).toBe(history);
      for (const fn of Object.values(storage)) expect(fn).not.toHaveBeenCalled();
    });

    it('should report conflicts and keep the current value until resolved when both sides changed a field', async () => {
      const { candidate } = await open(staleDraft({ ...OLD, a: 'mine' }));

      expect(candidate.preview().conflicts).toEqual([
        { path: 'a', base: 'old', mine: 'mine', theirs: 'server' },
      ]);
      expect(candidate.preview().merged.a).toBe('server');
      expect(candidate.preview({ a: 'mine' }).merged.a).toBe('mine');
      expect(candidate.preview({ a: 'theirs' }).merged.a).toBe('server');
    });

    it('should report valid false when validate rejects the merged values', async () => {
      const validate = vi.fn<(values: FieldValues) => boolean>((values) => values.b !== 'mine');
      const { candidate } = await open(undefined, { validate });

      expect(candidate.preview().valid).toBe(false);
      expect(validate).toHaveBeenCalledWith({ a: 'server', b: 'mine', c: 'c' });
    });

    it('should set the merged values and one undo entry when accepting', async () => {
      const { candidate, target } = await open();

      await candidate.accept();

      expect(target.form.getValues()).toEqual({ a: 'server', b: 'mine', c: 'c' });
      expect(target.store.getHistory().past).toEqual([
        { patches: [{ path: 'b', before: '', after: 'mine' }] },
      ]);
      expect(target.store.getHistory().future).toEqual([]);
    });

    it('should return to the target values when undoing once after accepting', async () => {
      const { candidate, target } = await open(staleDraft({ ...OLD, a: 'mine', b: 'mine' }));

      await candidate.accept({ a: 'mine' });
      expect(target.form.getValues()).toEqual({ a: 'mine', b: 'mine', c: 'c' });
      target.store.undo();

      expect(target.form.getValues()).toEqual({ a: 'server', b: '', c: 'c' });
      expect(canUndo(target.store.getHistory())).toBe(false);
    });

    it('should merge onto the edited values when the user edited while the candidate was pending', async () => {
      const { candidate, target } = await open();
      target.form.setValue('c', 'edited');

      await candidate.accept();
      expect(target.form.getValues()).toEqual({ a: 'server', b: 'mine', c: 'edited' });
      target.store.undo();

      expect(target.form.getValues()).toEqual({ a: 'server', b: '', c: 'edited' });
    });

    it('should save the current revision with base and delete the stale revisions when accepting', async () => {
      const { candidate, storage } = await open();
      await storage.save({ ...REV, revision: 'r0' }, staleDraft(OLD));
      await storage.save({ ...REV, document: 'other' }, staleDraft(OLD));

      await candidate.accept();

      const saved = await storage.load(REV);
      expect(saved).toMatchObject({
        values: { a: 'server', b: 'mine', c: 'c' },
        base: { ...OLD, a: 'server' },
      });
      expect(saved?.history.past).toHaveLength(1);
      expect((await storage.listRevisions('u1', 'doc')).map((r) => r.revision)).toEqual(['r2']);
      expect(await storage.listRevisions('u1', 'other')).toHaveLength(1);
    });

    it('should issue removeRevisions before save when accepting', async () => {
      const { candidate, storage } = await open();
      vi.clearAllMocks();

      await candidate.accept();

      expect(storage.removeRevisions).toHaveBeenCalledWith('u1', 'doc', 'r2');
      expect(storage.removeRevisions.mock.invocationCallOrder[0]).toBeLessThan(
        storage.save.mock.invocationCallOrder[0],
      );
    });

    it('should not save again from the debounced writer when accepting', async () => {
      const { candidate, storage } = await open();
      vi.clearAllMocks();

      await candidate.accept();
      await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);

      expect(storage.save).toHaveBeenCalledTimes(1);
    });

    it('should keep saving later edits when they happen after accepting', async () => {
      const { candidate, storage, target } = await open();
      await candidate.accept();

      target.form.setValue('c', 'later');
      await vi.advanceTimersByTimeAsync(DEBOUNCE);

      const saved = await storage.load(REV);
      expect(saved?.values.c).toBe('later');
      expect(saved?.base).toEqual({ ...OLD, a: 'server' });
    });

    it('should only delete the stale drafts and leave the history alone when the merge changes nothing', async () => {
      const { candidate, target, storage } = await open(staleDraft({ ...OLD, a: 'server' }), {
        server: { ...OLD, a: 'server' },
      });
      target.form.setValue('c', 'edited');
      const history = target.store.getHistory();
      vi.clearAllMocks();

      await candidate.accept();

      expect(target.store.getHistory()).toBe(history);
      expect(storage.save).not.toHaveBeenCalled();
      expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
    });

    it('should delete the stale drafts and leave the form untouched when discarding', async () => {
      const { candidate, target, storage } = await open();
      await storage.save({ ...REV, revision: 'r0' }, staleDraft(OLD));
      const history = target.store.getHistory();

      await candidate.discard();

      expect(target.form.getValues()).toEqual({ ...OLD, a: 'server' });
      expect(target.store.getHistory()).toBe(history);
      expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
    });

    it('should keep the stale drafts when disposed without a decision', async () => {
      const { p, storage } = await open();

      p.dispose();

      expect((await storage.listRevisions('u1', 'doc')).map((r) => r.revision)).toEqual(['r1']);
    });

    it('should reject with RecoveryUnavailableError when settling after the candidate was settled', async () => {
      const accepted = await open();
      await accepted.candidate.accept();
      const discarded = await open();
      await discarded.candidate.discard();

      await expect(accepted.candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(accepted.candidate.discard()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(discarded.candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(discarded.candidate.discard()).rejects.toBeInstanceOf(RecoveryUnavailableError);
    });

    it('should reject with RecoveryUnavailableError and keep the form when another instance settled first', async () => {
      const storage = spyStorage();
      const first = await open(undefined, { storage });
      const second = await open(undefined, { storage });
      await first.candidate.accept();
      const before = second.target.form.getValues();

      await expect(second.candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);

      expect(second.target.form.getValues()).toEqual(before);
      expect(canUndo(second.target.store.getHistory())).toBe(false);
      expect((await storage.listRevisions('u1', 'doc')).map((r) => r.revision)).toEqual(['r2']);
    });

    it('should reject with RecoveryUnavailableError and keep the form when the draft became unsafe', async () => {
      const { candidate, target, storage } = await open();
      const values = JSON.parse('{"a":"old","b":"x","c":"c","__proto__":{"polluted":true}}');
      await storage.save(STALE, staleDraft(values));

      await expect(candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);

      expect(target.form.getValues()).toEqual({ ...OLD, a: 'server' });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should reject with RecoveryUnavailableError and create no record when another context cleared all drafts', async () => {
      vi.useRealTimers();
      const indexedDB = new IDBFactory();
      const storage = spyStorage(createIndexedDbStorage({ indexedDB, IDBKeyRange }));
      const other = createIndexedDbStorage({ indexedDB, IDBKeyRange });
      const { candidate } = await open(undefined, { storage });

      await other.clearAll();

      await expect(candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      expect(await other.load(REV)).toBeUndefined();
      expect(await other.listRevisions('u1', 'doc')).toEqual([]);
    });

    it('should reject with DraftsClearedError, halt persistence and create no record when the save is refused after a clear', async () => {
      vi.useRealTimers();
      const indexedDB = new IDBFactory();
      const storage = spyStorage(createIndexedDbStorage({ indexedDB, IDBKeyRange }));
      const other = createIndexedDbStorage({ indexedDB, IDBKeyRange });
      const { candidate, target } = await open(undefined, { storage });
      // Another context logged out, then a draft showed up again for the same stale revision.
      await other.clearAll();
      await other.save(STALE, staleDraft({ ...OLD, b: 'mine' }));

      await expect(candidate.accept()).rejects.toBeInstanceOf(DraftsClearedError);
      target.form.setValue('c', 'later');
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 50));

      expect(await other.load(REV)).toBeUndefined();
      await expect(candidate.accept()).rejects.toBeInstanceOf(RecoveryUnavailableError);
    });
  });
});

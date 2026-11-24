import { createFormHistoryStore } from '@yoo-digital/rhf-history';
import { createFormControl } from 'react-hook-form';
import { test } from 'vitest';
import { createLargeDefaults } from '../test/fixtures/largeDefaults';
import { persistFormHistory } from './persistFormHistory';
import { createMemoryStorage, type DraftKey } from './storage';

// `createMemoryStorage` structuredClones on save, which is the closest proxy for the main-thread
// cost of IndexedDB's `put` (it also structured-clones the record synchronously, then writes off-thread).
async function createPersisted(
  rowCount: number,
  key: DraftKey,
): Promise<{ edit: () => void; flush: () => Promise<void> }> {
  const { formControl } = createFormControl({ defaultValues: createLargeDefaults(rowCount) });
  for (let i = 0; i < rowCount; i++) {
    for (const field of ['label', 'amount', 'note'] as const)
      formControl.register(`rows.${i}.${field}`);
  }
  const store = createFormHistoryStore(formControl);
  store.connect();
  const persistence = persistFormHistory(formControl, store, {
    storage: createMemoryStorage(),
    key,
    version: 1,
    debounceMs: 60_000,
  });
  await persistence.restored;
  let i = 0;
  // One edit followed by an immediate write; includes the edit itself (see the 'edit only' baseline).
  const edit = (): void => formControl.setValue('rows.5.label', `x${i++}`);
  return { edit, flush: persistence.flush };
}

const revisionKey = { scope: 'bench', document: 'doc', revision: 'r1' };

// Run with `pnpm -F @yoo-digital/rhf-history exec vitest bench --run --reporter=verbose`.
// Compares the synchronous cost of one save (record + storage clone) with and without a base.
for (const rowCount of [1_000, 10_000]) {
  test(`save on a form with ${rowCount * 3} fields`, async ({ bench }) => {
    const edited = await createPersisted(rowCount, 'bench-edit-only');
    const plain = await createPersisted(rowCount, 'bench-string');
    const withBase = await createPersisted(rowCount, revisionKey);

    await bench.compare(
      bench('edit only (baseline, no save)', () => edited.edit()),
      bench('string key (no base)', () => {
        plain.edit();
        void plain.flush();
      }),
      bench('RevisionKey (with base)', () => {
        withBase.edit();
        void withBase.flush();
      }),
    );
  });
}

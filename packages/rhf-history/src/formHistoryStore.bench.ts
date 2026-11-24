import { createFormControl } from 'react-hook-form';
import { test } from 'vitest';
import { createLargeDefaults, type LargeValues } from '../test/fixtures/largeDefaults';
import { createFormHistoryStore } from './formHistoryStore';

type LargeFormControl = ReturnType<typeof createFormControl<LargeValues>>['formControl'];

function createForm(rowCount: number, withHistory: boolean): LargeFormControl {
  const { formControl } = createFormControl({ defaultValues: createLargeDefaults(rowCount) });
  for (let i = 0; i < rowCount; i++) {
    for (const key of ['label', 'amount', 'note'] as const)
      formControl.register(`rows.${i}.${key}`);
  }
  if (withHistory) createFormHistoryStore(formControl).connect();
  return formControl;
}

// Run with `npm run bench`. Compares the cost of one field change with and without history.
for (const rowCount of [70, 100, 1_000, 10_000]) {
  test(`setValue on a form with ${rowCount * 3} fields`, async ({ bench }) => {
    const bare = createForm(rowCount, false);
    const tracked = createForm(rowCount, true);
    let i = 0;

    await bench.compare(
      bench('without history', () => bare.setValue('rows.5.label', `x${i++}`)),
      bench('with history', () => tracked.setValue('rows.5.label', `x${i++}`)),
    );
  });
}

import type * as v from 'valibot';
import type { LargeSchema } from './largeSchema';

export type LargeValues = v.InferInput<typeof LargeSchema>;

export function createLargeDefaults(rowCount: number): LargeValues {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => ({
      label: `Row ${i + 1}`,
      amount: '0',
      note: '',
    })),
  };
}

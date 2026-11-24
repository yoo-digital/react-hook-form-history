import * as v from 'valibot';

export const LargeSchema = v.object({
  rows: v.array(
    v.object({
      label: v.pipe(v.string(), v.maxLength(20, 'Max 20 characters')),
      amount: v.pipe(v.string(), v.regex(/^\d*$/, 'Digits only')),
      note: v.string(),
    }),
  ),
});

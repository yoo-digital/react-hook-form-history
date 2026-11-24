import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProfilerOnRenderCallback } from 'react';
import { createFormControl } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { createLargeDefaults, type LargeValues } from '../test/fixtures/largeDefaults';
import { LargeForm } from '../test/fixtures/LargeForm';
import { createFormHistoryStore, type FormHistoryStore } from './formHistoryStore';

describe('LargeForm', () => {
  it('should not re-render the field list when edits are recorded, undone and redone', async () => {
    const user = userEvent.setup();
    const onFieldsRender = vi.fn<ProfilerOnRenderCallback>();
    render(
      <LargeForm
        rowCount={1_000}
        onFieldsRender={onFieldsRender}
      />,
    );
    const commitsAfterMount = onFieldsRender.mock.calls.length;

    const note = screen.getByLabelText('Note 500');
    await user.type(note, 'hello');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(note).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(note).toHaveValue('hello');

    expect(screen.getByText(/1 undo · 0 redo/)).toBeInTheDocument();
    expect(onFieldsRender).toHaveBeenCalledTimes(commitsAfterMount);
  });
});

describe('createFormHistoryStore at scale', () => {
  function setup(rowCount: number): {
    form: ReturnType<typeof createFormControl<LargeValues>>['formControl'];
    store: FormHistoryStore;
    disconnect: () => void;
  } {
    const { formControl } = createFormControl({ defaultValues: createLargeDefaults(rowCount) });
    for (let i = 0; i < rowCount; i++) {
      for (const key of ['label', 'amount', 'note'] as const)
        formControl.register(`rows.${i}.${key}`);
    }
    const store = createFormHistoryStore(formControl);
    const disconnect = store.connect();
    return { form: formControl, store, disconnect };
  }

  it('should store only the changed field when one of many fields changes', () => {
    const { form, store } = setup(10_000);

    form.setValue('rows.9999.note', 'last');

    expect(store.getHistory().past).toEqual([
      { patches: [{ path: 'rows.9999.note', before: '', after: 'last' }] },
    ]);
  });

  it('should write back only the changed field when undoing', () => {
    const { form, store } = setup(10_000);
    form.setValue('rows.42.label', 'changed');
    const setValue = vi.spyOn(form, 'setValue');

    store.undo();

    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith('rows.42.label', 'Row 43', { shouldDirty: true });
    expect(form.getValues('rows.42.label')).toBe('Row 43');
  });

  it('should keep memory proportional to edits when many steps are recorded', () => {
    const { form, store } = setup(10_000);

    for (let i = 0; i < 150; i++) {
      store.checkpoint();
      form.setValue(`rows.${i}.amount`, String(i + 1));
    }

    const { past } = store.getHistory();
    expect(past).toHaveLength(100);
    expect(past.every((entry) => entry.patches.length === 1)).toBe(true);
    expect(past[0].patches[0].path).toBe('rows.50.amount');
  });

  it('should record an external reset as one step when no field name is reported', () => {
    const { form, store } = setup(1_000);
    const next = createLargeDefaults(1_000);
    next.rows[3].note = 'a';
    next.rows[700].label = 'b';

    form.reset(next);
    expect(store.getHistory().past[0].patches.map((patch) => patch.path)).toEqual([
      'rows.3.note',
      'rows.700.label',
    ]);

    store.undo();
    expect(form.getValues('rows.3.note')).toBe('');
    expect(form.getValues('rows.700.label')).toBe('Row 701');
  });
});

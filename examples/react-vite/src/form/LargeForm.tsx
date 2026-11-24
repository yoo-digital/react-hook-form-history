import { valibotResolver } from '@hookform/resolvers/valibot';
import { useFormHistory, useUndoRedoHotkeys } from '@yoo-digital/rhf-history';
import { Profiler, useMemo, useRef, type JSX, type ProfilerOnRenderCallback } from 'react';
import { useForm, useFormState, type Control, type UseFormRegister } from 'react-hook-form';
import { HistoryToolbar } from '@/components/HistoryToolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLargeDefaults, type LargeValues } from './largeDefaults';
import { LargeSchema } from './largeSchema';

type Props = {
  rowCount: number;
  /** Called whenever the field list commits, to verify history updates don't re-render it. */
  onFieldsRender?: ProfilerOnRenderCallback;
};

/** Stress-test form: `rowCount * 3` registered fields sharing one undo history. */
export function LargeForm({ rowCount, onFieldsRender = (): void => {} }: Props): JSX.Element {
  const defaultValues = useMemo(() => createLargeDefaults(rowCount), [rowCount]);
  // Rows aren't a field array, so a row's identity is its field path.
  const rowPaths = useMemo(
    () => defaultValues.rows.map((_, i) => `rows.${i}` as const),
    [defaultValues],
  );
  const form = useForm<LargeValues>({ resolver: valibotResolver(LargeSchema), defaultValues });
  const history = useFormHistory(form);
  const formRef = useRef<HTMLFormElement>(null);
  useUndoRedoHotkeys(formRef, history);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus leaving any field closes the current undo step
    <form
      ref={formRef}
      className="border bg-card"
      noValidate
      onSubmit={form.handleSubmit(() => {})}
      onBlur={history.checkpoint}
    >
      <HistoryToolbar
        history={history}
        control={form.control}
      />
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <ErrorSummary control={form.control} />
        <Profiler
          id="large-form-fields"
          onRender={onFieldsRender}
        >
          <div className="flex flex-col gap-2">
            {rowPaths.map((path, i) => (
              <LargeRow
                key={path}
                path={path}
                index={i}
                register={form.register}
              />
            ))}
          </div>
        </Profiler>
        <div>
          <Button type="submit">Validate</Button>
        </div>
      </div>
    </form>
  );
}

function LargeRow({
  path,
  index,
  register,
}: {
  path: `rows.${number}`;
  index: number;
  register: UseFormRegister<LargeValues>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_5.5rem] gap-2 sm:grid-cols-[1fr_7rem_1.4fr]">
      <Input
        aria-label={`Label ${index + 1}`}
        {...register(`${path}.label`)}
      />
      <Input
        aria-label={`Amount ${index + 1}`}
        inputMode="numeric"
        {...register(`${path}.amount`)}
      />
      <Input
        aria-label={`Note ${index + 1}`}
        className="col-span-2 sm:col-span-1"
        {...register(`${path}.note`)}
      />
    </div>
  );
}

/** Reads errors in a leaf component so validation doesn't re-render all fields. */
function ErrorSummary({ control }: { control: Control<LargeValues> }): JSX.Element | null {
  const { errors } = useFormState({ control });
  const count = errors.rows?.filter?.(Boolean).length ?? 0;
  return count ? (
    <p
      role="alert"
      className="text-xs text-destructive"
    >
      {count} row(s) invalid
    </p>
  ) : null;
}

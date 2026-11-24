import { valibotResolver } from '@hookform/resolvers/valibot';
import { useRef, type JSX } from 'react';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import type { FormHistoryStore } from '../../src/formHistoryStore';
import { useFormHistory } from '../../src/useFormHistory';
import { useUndoRedoHotkeys } from '../../src/useUndoRedoHotkeys';
import { HistoryToolbar } from './HistoryToolbar';
import { ProfileSchema, defaultProfile, type ProfileInput, type ProfileOutput } from './schema';

type Props = {
  onSubmit: (values: ProfileOutput) => void;
};

export function ProfileForm({ onSubmit }: Props): JSX.Element {
  const form = useForm<ProfileInput, unknown, ProfileOutput>({
    resolver: valibotResolver(ProfileSchema),
    defaultValues: defaultProfile,
  });
  const { control, handleSubmit, reset } = form;

  const history = useFormHistory(form);
  const formRef = useRef<HTMLFormElement>(null);
  useUndoRedoHotkeys(formRef, history);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus leaving any field closes the current undo step
    <form
      ref={formRef}
      className="profile-form"
      noValidate
      onSubmit={handleSubmit((values) => {
        onSubmit(values);
        // The submitted values become the new baseline.
        reset(form.getValues());
        history.clear();
      })}
      onBlur={history.checkpoint}
    >
      <HistoryToolbar
        history={history}
        control={control}
      />

      <BasicFields form={form} />

      <SkillsFieldset
        form={form}
        history={history}
      />

      <button type="submit">Save</button>
    </form>
  );
}

type FormProps = { form: UseFormReturn<ProfileInput, unknown, ProfileOutput> };

function BasicFields({
  form: {
    register,
    formState: { errors },
  },
}: FormProps): JSX.Element {
  return (
    <>
      <label>
        Name
        <input
          {...register('name')}
          aria-invalid={!!errors.name}
        />
      </label>
      {errors.name && <p role="alert">{errors.name.message}</p>}

      <label>
        Email
        <input
          type="email"
          {...register('email')}
          aria-invalid={!!errors.email}
        />
      </label>
      {errors.email && <p role="alert">{errors.email.message}</p>}

      <label>
        Role
        <select {...register('role')}>
          <option value="developer">Developer</option>
          <option value="designer">Designer</option>
          <option value="manager">Manager</option>
        </select>
      </label>

      <label className="inline">
        <input
          type="checkbox"
          {...register('newsletter')}
        />
        Subscribe to newsletter
      </label>
    </>
  );
}

function SkillsFieldset({
  form: {
    register,
    control,
    formState: { errors },
  },
  history,
}: FormProps & { history: FormHistoryStore }): JSX.Element {
  const skills = useFieldArray({ control, name: 'skills' });
  return (
    <fieldset>
      <legend>Skills</legend>
      {skills.fields.map((field, index) => (
        <div
          key={field.id}
          className="row"
        >
          <input
            aria-label={`Skill ${index + 1}`}
            {...register(`skills.${index}.label`)}
            aria-invalid={!!errors.skills?.[index]?.label}
          />
          <button
            type="button"
            onClick={() => skills.remove(index)}
          >
            Remove
          </button>
          {errors.skills?.[index]?.label && (
            <p role="alert">{errors.skills[index].label.message}</p>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          history.checkpoint();
          skills.append({ label: '' });
        }}
      >
        Add skill
      </button>
    </fieldset>
  );
}

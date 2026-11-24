import { valibotResolver } from '@hookform/resolvers/valibot';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, InfoIcon } from '@phosphor-icons/react';
import {
  useFormHistory,
  useUndoRedoHotkeys,
  type FormHistoryStore,
} from '@yoo-digital/rhf-history';
import {
  nullStorage,
  usePersistedFormHistory,
  type FormHistoryStorage,
} from '@yoo-digital/rhf-history-persist';
import { useRef, type JSX, type RefObject } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldPathByValue,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import { HistoryToolbar } from '@/components/HistoryToolbar';
import { RecoveryDialog } from '@/components/RecoveryDialog';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { profileDraftKey } from '@/drafts';
import type { ServerProfile } from './fakeServer';
import { ProfileSchema, type ProfileInput, type ProfileOutput } from './schema';

/** Bump when the form's shape changes so stale drafts are discarded instead of restored. */
const DRAFT_VERSION = 3;

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'manager', label: 'Manager' },
];

type ProfileControl = Control<ProfileInput, unknown, ProfileOutput>;
type FormProps = { form: UseFormReturn<ProfileInput, unknown, ProfileOutput> };
type ArrayProps = FormProps & { history: FormHistoryStore };
type RowProps = FormProps & {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
};

type Props = {
  /** The profile as the server holds it, and the revision it is at. */
  server: ServerProfile;
  onSubmit: (values: ProfileOutput) => void;
  /** Where to keep the draft (values + undo history) across reloads. */
  storage?: FormHistoryStorage;
  /** Drafts older than this are discarded instead of restored. */
  maxAgeMs?: number;
};

function FieldError({ message }: { message?: string }): JSX.Element | null {
  return message ? (
    <p
      role="alert"
      className="text-xs text-destructive"
    >
      {message}
    </p>
  ) : null;
}

/** A checkbox bound to any boolean path, top-level or nested (`notifications.push`, `guests.0.coming`). */
function BooleanField({
  control,
  name,
  id,
  label,
}: {
  control: ProfileControl;
  name: FieldPathByValue<ProfileInput, boolean>;
  id: string;
  label: string;
}): JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked)}
            onBlur={field.onBlur}
          />
          <Label htmlFor={id}>{label}</Label>
        </div>
      )}
    />
  );
}

/** Move up / move down / remove for one row of a field array. */
function RowActions({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Move ${label} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDownIcon />
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <TrashIcon data-icon="inline-start" />
        Remove
      </Button>
    </div>
  );
}

/** Leaf subscriber: only this line re-renders when a guest's `coming` flag changes. */
function GuestSummary({ control }: { control: ProfileControl }): JSX.Element {
  const guests = useWatch({ control, name: 'guests' });
  const coming = guests.filter((guest) => guest.coming).length;
  return (
    <p
      className="text-xs text-muted-foreground"
      aria-live="polite"
    >
      {coming} of {guests.length} coming
    </p>
  );
}

/** The form, its undo history (with hotkeys) and its persisted draft. */
function useProfileForm(
  server: ServerProfile,
  { storage, maxAgeMs }: { storage: FormHistoryStorage; maxAgeMs?: number },
): {
  form: UseFormReturn<ProfileInput, unknown, ProfileOutput>;
  history: FormHistoryStore;
  formRef: RefObject<HTMLFormElement | null>;
  draft: ReturnType<typeof usePersistedFormHistory>;
  startOver: (values?: ProfileInput) => void;
} {
  const form = useForm<ProfileInput, unknown, ProfileOutput>({
    resolver: valibotResolver(ProfileSchema),
    defaultValues: server.values,
  });
  const { reset } = form;

  const history = useFormHistory(form);
  const formRef = useRef<HTMLFormElement>(null);
  useUndoRedoHotkeys(formRef, history);
  const draft = usePersistedFormHistory(form, history, {
    storage,
    key: profileDraftKey(server.revision),
    version: DRAFT_VERSION,
    maxAgeMs,
  });

  const startOver = (values?: ProfileInput): void => {
    reset(values);
    history.clear();
    void draft.clear();
  };

  return { form, history, formRef, draft, startOver };
}

export function ProfileForm({
  server,
  onSubmit,
  storage = nullStorage,
  maxAgeMs,
}: Props): JSX.Element {
  const { form, history, formRef, draft, startOver } = useProfileForm(server, {
    storage,
    maxAgeMs,
  });
  const { control, handleSubmit } = form;

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus leaving any field closes the current undo step */}
      <form
        ref={formRef}
        className="border bg-card"
        noValidate
        onSubmit={handleSubmit((values) => {
          toast.success('Profile saved', {
            description: 'The draft was cleared and history reset.',
          });
          // The submitted values become the new baseline; the draft is no longer needed.
          // Cleared before `onSubmit`, which bumps the revision and remounts this form.
          startOver(form.getValues());
          onSubmit(values);
        })}
        onBlur={history.checkpoint}
      >
        <HistoryToolbar
          history={history}
          control={control}
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          {draft.status === 'restored' && <DraftRestoredNotice onDiscard={() => startOver()} />}

          <ProfileFields
            form={form}
            history={history}
          />
        </div>
      </form>
      <RecoveryDialog recovery={draft.recovery} />
    </>
  );
}

function ProfileFields({ form, history }: ArrayProps): JSX.Element {
  return (
    <>
      <BasicFields form={form} />
      <NotificationsCard control={form.control} />
      <SkillsCard
        form={form}
        history={history}
      />
      <GuestsCard
        form={form}
        history={history}
      />

      <div>
        <Button type="submit">Save</Button>
      </div>
    </>
  );
}

function DraftRestoredNotice({ onDiscard }: { onDiscard: () => void }): JSX.Element {
  // A polite status message; the inner Alert only provides the styling.
  return (
    <output className="block">
      <Alert role="none">
        <InfoIcon />
        <AlertTitle>Restored your unsaved draft</AlertTitle>
        <AlertDescription>Your values and undo history survived the reload.</AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onDiscard}
          >
            Discard
          </Button>
        </AlertAction>
      </Alert>
    </output>
  );
}

function BasicFields({
  form: {
    register,
    control,
    formState: { errors },
  },
}: FormProps): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          {...register('name')}
          aria-invalid={!!errors.name}
        />
        <FieldError message={errors.name?.message} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          type="email"
          {...register('email')}
          aria-invalid={!!errors.email}
        />
        <FieldError message={errors.email?.message} />
      </div>
      <RoleField control={control} />
      <div className="flex items-end pb-1.5">
        <BooleanField
          control={control}
          name="newsletter"
          id="profile-newsletter"
          label="Subscribe to newsletter"
        />
      </div>
    </div>
  );
}

function RoleField({ control }: { control: ProfileControl }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        id="profile-role-label"
        htmlFor="profile-role"
      >
        Role
      </Label>
      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <Select
            items={ROLES}
            value={field.value}
            onValueChange={(value) => field.onChange(value)}
          >
            <SelectTrigger
              id="profile-role"
              className="w-full"
              aria-labelledby="profile-role-label"
              onBlur={field.onBlur}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => (
                <SelectItem
                  key={role.value}
                  value={role.value}
                >
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );
}

function NotificationsCard({ control }: { control: ProfileControl }): JSX.Element {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Booleans in a nested object. Each toggle is its own undo step, recorded at{' '}
          <code>notifications.email</code> and friends.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2">
        <BooleanField
          control={control}
          name="notifications.email"
          id="notify-email"
          label="Email updates"
        />
        <BooleanField
          control={control}
          name="notifications.push"
          id="notify-push"
          label="Push notifications"
        />
        <BooleanField
          control={control}
          name="notifications.weeklyDigest"
          id="notify-digest"
          label="Weekly digest"
        />
      </CardContent>
    </Card>
  );
}

/**
 * Field-array edits with a checkpoint first, so a reorder, append or removal is its own undo
 * step instead of merging into a quick edit of the same array just before it.
 */
type ArrayEdits = { move: (from: number, to: number) => void; remove: (index: number) => void };

function withCheckpoints(array: ArrayEdits, history: FormHistoryStore): ArrayEdits {
  return {
    move: (from, to) => {
      history.checkpoint();
      array.move(from, to);
    },
    remove: (index) => {
      history.checkpoint();
      array.remove(index);
    },
  };
}

function SkillsCard({ form, history }: ArrayProps): JSX.Element {
  const { control } = form;
  const skills = useFieldArray({ control, name: 'skills' });
  const { move: moveSkill, remove: removeSkill } = withCheckpoints(skills, history);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          A sortable field array: adding, removing or moving a row is one undo step.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {skills.fields.map((field, index) => (
          <SkillRow
            key={field.id}
            form={form}
            index={index}
            count={skills.fields.length}
            onMove={moveSkill}
            onRemove={() => removeSkill(index)}
          />
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              history.checkpoint();
              skills.append({ label: '' });
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Add skill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GuestsCard({ form, history }: ArrayProps): JSX.Element {
  const { control } = form;
  const guests = useFieldArray({ control, name: 'guests' });
  const { move: moveGuest, remove: removeGuest } = withCheckpoints(guests, history);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Guests</CardTitle>
        <CardDescription>
          A sortable array of objects with a text and a boolean field (<code>guests.0.name</code>,{' '}
          <code>guests.0.coming</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {guests.fields.map((field, index) => (
          <GuestRow
            key={field.id}
            form={form}
            id={field.id}
            index={index}
            count={guests.fields.length}
            onMove={moveGuest}
            onRemove={() => removeGuest(index)}
          />
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              history.checkpoint();
              guests.append({ name: '', coming: true });
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Add guest
          </Button>
          <GuestSummary control={control} />
        </div>
      </CardContent>
    </Card>
  );
}

function SkillRow({
  form: {
    register,
    formState: { errors },
  },
  index,
  count,
  onMove,
  onRemove,
}: RowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          aria-label={`Skill ${index + 1}`}
          {...register(`skills.${index}.label`)}
          aria-invalid={!!errors.skills?.[index]?.label}
        />
        <RowActions
          label={`skill ${index + 1}`}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <FieldError message={errors.skills?.[index]?.label?.message} />
    </div>
  );
}

function GuestRow({
  form: {
    register,
    control,
    formState: { errors },
  },
  id,
  index,
  count,
  onMove,
  onRemove,
}: RowProps & { id: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-32 flex-1"
          aria-label={`Guest ${index + 1} name`}
          {...register(`guests.${index}.name`)}
          aria-invalid={!!errors.guests?.[index]?.name}
        />
        <BooleanField
          control={control}
          name={`guests.${index}.coming`}
          id={`guest-${id}-coming`}
          label="Coming"
        />
        <RowActions
          label={`guest ${index + 1}`}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <FieldError message={errors.guests?.[index]?.name?.message} />
    </div>
  );
}

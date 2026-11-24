import type { Patch } from '@yoo-digital/rhf-history';
import type { Conflict, RecoveryCandidate, Resolutions } from '@yoo-digital/rhf-history-persist';
import { useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = {
  recovery: RecoveryCandidate | null;
};

const show = (value: unknown): string => {
  if (value === '') return '(empty)';
  if (value === undefined) return '(none)';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

function Value({ children }: { children: unknown }): JSX.Element {
  return <code className="break-all bg-muted px-1 py-0.5">{show(children)}</code>;
}

/**
 * Isolated like the toolbar: previewing and choosing re-renders only the dialog,
 * never the form around it. The form stays mounted behind the modal.
 */
export function RecoveryDialog({ recovery }: Props): JSX.Element | null {
  if (!recovery) return null;
  // Keyed so a new candidate starts with fresh choices.
  return (
    <RecoveryDialogContent
      key={`${recovery.revision}:${recovery.savedAt}`}
      recovery={recovery}
    />
  );
}

function RecoveryDialogContent({ recovery }: { recovery: RecoveryCandidate }): JSX.Element {
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const { busy, run } = useToastedAction();
  const preview = useMemo(() => recovery.preview(resolutions), [recovery, resolutions]);

  const nothingToRecover = preview.applied.length === 0 && preview.conflicts.length === 0;

  // No close handler: the user has to pick Recover or Discard.
  return (
    <Dialog open>
      <DialogContent>
        <RecoveryHeader revision={recovery.revision} />

        {!preview.valid && (
          <p
            role="alert"
            className="text-destructive"
          >
            This draft can't be merged into the current profile.
          </p>
        )}

        {preview.applied.length > 0 && <AppliedChanges applied={preview.applied} />}

        {preview.conflicts.length > 0 && (
          <ConflictList
            conflicts={preview.conflicts}
            resolutions={resolutions}
            onChoose={(path, value) => setResolutions((current) => ({ ...current, [path]: value }))}
          />
        )}

        {nothingToRecover && preview.valid && (
          <p className="text-muted-foreground">Your draft has no changes left to apply.</p>
        )}

        <RecoveryActions
          busy={busy}
          canRecover={preview.valid}
          onDiscard={() => run(() => recovery.discard(), 'Draft discarded')}
          onRecover={() =>
            run(
              () => recovery.accept(resolutions),
              'Draft recovered. Undo returns to the server version.',
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/** Runs one action at a time and reports its outcome as a toast. */
function useToastedAction(): {
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function RecoveryHeader({ revision }: { revision: string }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Recover your unsaved changes?</DialogTitle>
      <DialogDescription>
        You had unsaved changes on revision {revision}. The profile has changed on the server since.
        Your changes can be applied on top of the new version.
      </DialogDescription>
    </DialogHeader>
  );
}

function RecoveryActions({
  busy,
  canRecover,
  onDiscard,
  onRecover,
}: {
  busy: boolean;
  canRecover: boolean;
  onDiscard: () => void;
  onRecover: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button
        type="button"
        disabled={busy || !canRecover}
        onClick={onRecover}
      >
        Recover
      </Button>
    </DialogFooter>
  );
}

function AppliedChanges({ applied }: { applied: Patch[] }): JSX.Element {
  return (
    <section
      aria-labelledby="recovery-applied"
      className="flex flex-col gap-2"
    >
      <h3
        id="recovery-applied"
        className="font-medium"
      >
        Changes that apply cleanly
      </h3>
      <ul className="flex flex-col gap-1.5">
        {applied.map((patch) => (
          <li
            key={patch.path}
            className="flex flex-col gap-0.5"
          >
            <span className="font-mono text-muted-foreground">{patch.path}</span>
            <span>
              <Value>{patch.before}</Value> → <Value>{patch.after}</Value>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Choice = 'mine' | 'theirs';

function ConflictList({
  conflicts,
  resolutions,
  onChoose,
}: {
  conflicts: Conflict[];
  resolutions: Resolutions;
  onChoose: (path: string, value: Choice) => void;
}): JSX.Element {
  return (
    <section
      aria-labelledby="recovery-conflicts"
      className="flex flex-col gap-2"
    >
      <h3
        id="recovery-conflicts"
        className="font-medium"
      >
        Conflicts
      </h3>
      <ul className="flex flex-col gap-3">
        {conflicts.map((conflict) => (
          <ConflictItem
            key={conflict.path}
            conflict={conflict}
            choice={resolutions[conflict.path] ?? 'theirs'}
            onChoose={(value) => onChoose(conflict.path, value)}
          />
        ))}
      </ul>
    </section>
  );
}

function ConflictItem({
  conflict,
  choice,
  onChoose,
}: {
  conflict: Conflict;
  choice: Choice;
  onChoose: (value: Choice) => void;
}): JSX.Element {
  return (
    <li className="flex flex-col gap-1.5 border p-2">
      <span className="font-mono text-muted-foreground">{conflict.path}</span>
      <span>
        Server: <Value>{conflict.theirs}</Value>
      </span>
      <span>
        Yours: <Value>{conflict.mine}</Value>
      </span>
      <fieldset
        aria-label={`Resolve ${conflict.path}`}
        className="flex gap-1.5"
      >
        <Button
          type="button"
          size="xs"
          variant={choice === 'theirs' ? 'default' : 'outline'}
          aria-pressed={choice === 'theirs'}
          onClick={() => onChoose('theirs')}
        >
          Keep server
        </Button>
        <Button
          type="button"
          size="xs"
          variant={choice === 'mine' ? 'default' : 'outline'}
          aria-pressed={choice === 'mine'}
          onClick={() => onChoose('mine')}
        >
          Keep mine
        </Button>
      </fieldset>
    </li>
  );
}

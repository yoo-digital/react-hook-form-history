import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import type { FormHistoryStore } from '@yoo-digital/rhf-history';
import { useFormHistoryState } from '@yoo-digital/rhf-history';
import type { JSX, ReactNode } from 'react';
import { useFormState, type Control, type FieldValues } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { modKey, shiftKey } from '@/lib/platform';

type Props<T extends FieldValues> = {
  history: FormHistoryStore;
  control: Control<T>;
};

/**
 * Isolated so that history and dirty-state updates re-render only the toolbar,
 * never the (potentially huge) form around it.
 */
export function HistoryToolbar<T extends FieldValues>({ history, control }: Props<T>): JSX.Element {
  const { canUndo, canRedo, undoCount, redoCount } = useFormHistoryState(history);

  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-card/90 px-4 py-2 backdrop-blur sm:px-6"
      role="toolbar"
      aria-label="History"
    >
      <HistoryButton
        label="Undo"
        icon={<ArrowCounterClockwiseIcon data-icon="inline-start" />}
        keys={[modKey, 'Z']}
        onClick={history.undo}
        disabled={!canUndo}
      />
      <HistoryButton
        label="Redo"
        icon={<ArrowClockwiseIcon data-icon="inline-start" />}
        keys={[modKey, shiftKey, 'Z']}
        onClick={history.redo}
        disabled={!canRedo}
      />

      <HistoryStatus
        undoCount={undoCount}
        redoCount={redoCount}
        control={control}
      />
    </div>
  );
}

function HistoryButton({
  label,
  icon,
  keys,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  keys: string[];
  onClick: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        {icon}
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <KbdGroup>
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}

/** Reads `isDirty` itself, so dirty-state updates re-render only the badges. */
function HistoryStatus<T extends FieldValues>({
  undoCount,
  redoCount,
  control,
}: {
  undoCount: number;
  redoCount: number;
  control: Control<T>;
}): JSX.Element {
  const { isDirty } = useFormState({ control });
  return (
    <div
      className="ml-auto flex items-center gap-1.5"
      aria-live="polite"
    >
      <Badge
        variant="secondary"
        className="tabular-nums"
      >
        {undoCount} undo
      </Badge>
      <Badge
        variant="secondary"
        className="tabular-nums"
      >
        {redoCount} redo
      </Badge>
      {isDirty && (
        <Badge
          variant="outline"
          className="gap-1.5"
        >
          <span
            aria-hidden
            className="size-1.5 bg-mark"
          />
          Unsaved changes
        </Badge>
      )}
    </div>
  );
}

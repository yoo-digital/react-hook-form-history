import { ShieldWarningIcon } from '@phosphor-icons/react';
import { ExpiredDraftsCleanup } from '@yoo-digital/rhf-history-persist';
import { useState, type JSX } from 'react';
import { flushSync } from 'react-dom';
import { DraftInspector } from '@/components/DraftInspector';
import { HowItWorks } from '@/components/HowItWorks';
import { SiteHeader } from '@/components/SiteHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/useTheme';
import { modKey, shiftKey } from '@/lib/platform';
import { DRAFT_MAX_AGE_MS, draftStorage } from './drafts';
import {
  readServerProfile,
  saveServerProfile,
  simulateRevision,
  type ServerProfile,
} from './form/fakeServer';
import { LargeForm } from './form/LargeForm';
import { ProfileForm } from './form/ProfileForm';
import type { ProfileOutput } from './form/schema';

const SIZES = [100, 1_000, 5_000].map((rows) => ({
  value: rows,
  label: `${rows.toLocaleString('en-US')} rows (${(rows * 3).toLocaleString('en-US')} fields)`,
}));

type View = 'profile' | 'large';

function App(): JSX.Element {
  const { theme } = useTheme();
  return (
    <TooltipProvider>
      {/* Drops drafts nobody came back to. Forms get the same maxAgeMs, so mount order doesn't matter. */}
      <ExpiredDraftsCleanup
        storage={draftStorage}
        maxAgeMs={DRAFT_MAX_AGE_MS}
      />
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 pb-20 sm:px-6">
        <Demo />
        <HowItWorks />
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        MIT licensed. Built with react-hook-form, valibot and shadcn/ui.
      </footer>
      <Toaster
        theme={theme}
        position="bottom-right"
      />
    </TooltipProvider>
  );
}

function Demo(): JSX.Element {
  const [view, setView] = useState<View>('profile');
  const [rowCount, setRowCount] = useState(1_000);
  const [submitted, setSubmitted] = useState<ProfileOutput | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [server, setServer] = useState(readServerProfile);
  const { isClearing, clearError, clearAllDrafts } = useClearAllDrafts(() =>
    setFormKey((key) => key + 1),
  );

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as View)}
    >
      <DemoControls
        view={view}
        rowCount={rowCount}
        onRowCountChange={setRowCount}
        onSimulateRevision={() => setServer(simulateRevision())}
        onClearAll={clearAllDrafts}
        isClearing={isClearing}
      />
      <ShortcutHint />
      <PrivacyNote />
      {clearError && <ClearError message={clearError} />}

      <TabsContent value="profile">
        {isClearing ? null : (
          <ProfileDemo
            formKey={formKey}
            server={server}
            submitted={submitted}
            onSubmit={(values) => {
              setSubmitted(values);
              setServer(saveServerProfile(values));
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="large">
        {isClearing ? null : (
          <LargeForm
            key={rowCount}
            rowCount={rowCount}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

function useClearAllDrafts(onCleared: () => void): {
  isClearing: boolean;
  clearError: string | null;
  clearAllDrafts: () => Promise<void>;
} {
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const clearAllDrafts = async (): Promise<void> => {
    // Unmount forms first so their final save is issued before the clear.
    flushSync(() => {
      setIsClearing(true);
      setClearError(null);
    });
    try {
      await draftStorage.clearAll();
      onCleared();
    } catch (error) {
      // Don't pretend it worked: the remounted form restores whatever is still stored.
      // oxlint-disable-next-line no-console -- report the cause; the UI shows a generic message
      console.error('[form-history] clearing drafts failed', error);
      setClearError('Drafts could not be deleted. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  return { isClearing, clearError, clearAllDrafts };
}

function DemoControls({
  view,
  rowCount,
  onRowCountChange,
  onSimulateRevision,
  onClearAll,
  isClearing,
}: {
  view: View;
  rowCount: number;
  onRowCountChange: (rowCount: number) => void;
  onSimulateRevision: () => void;
  onClearAll: () => void;
  isClearing: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <ViewTabs />
      {view === 'large' && (
        <RowCountSelect
          value={rowCount}
          onChange={onRowCountChange}
        />
      )}
      {view === 'profile' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sm:ml-auto"
          onClick={onSimulateRevision}
          disabled={isClearing}
        >
          Simulate new server revision
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={view === 'profile' ? undefined : 'sm:ml-auto'}
        onClick={onClearAll}
        disabled={isClearing}
      >
        Clear all drafts
      </Button>
    </div>
  );
}

function ViewTabs(): JSX.Element {
  return (
    <TabsList>
      <TabsTrigger value="profile">Profile form</TabsTrigger>
      <TabsTrigger value="large">Large form</TabsTrigger>
    </TabsList>
  );
}

function ClearError({ message }: { message: string }): JSX.Element {
  return (
    <p
      role="alert"
      className="text-xs text-destructive"
    >
      {message}
    </p>
  );
}

function RowCountSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (rowCount: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="row-count">Rows</Label>
      <Select
        items={SIZES}
        value={value}
        onValueChange={(next) => next !== null && onChange(next)}
      >
        <SelectTrigger
          id="row-count"
          aria-label="Rows"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SIZES.map((size) => (
            <SelectItem
              key={size.value}
              value={size.value}
            >
              {size.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ShortcutHint(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Focus a field, then undo with{' '}
      <KbdGroup>
        <Kbd>{modKey}</Kbd>
        <Kbd>Z</Kbd>
      </KbdGroup>{' '}
      and redo with{' '}
      <KbdGroup>
        <Kbd>{modKey}</Kbd>
        <Kbd>{shiftKey}</Kbd>
        <Kbd>Z</Kbd>
      </KbdGroup>
      . Edits are saved as a draft in IndexedDB, so a reload keeps your history.
    </p>
  );
}

function PrivacyNote(): JSX.Element {
  return (
    <Alert role="note">
      <ShieldWarningIcon />
      <AlertTitle>Private data? Clear drafts on logout.</AlertTitle>
      <AlertDescription>
        Drafts are stored unencrypted in this browser and outlive the session. If a form can contain
        personal or confidential information, call <code>storage.clearAll()</code> on logout, after
        unmounting the forms, so the next person using this browser can't restore it.{' '}
        <em>Clear all drafts</em> above does exactly that.
      </AlertDescription>
    </Alert>
  );
}

function ProfileDemo({
  formKey,
  server,
  submitted,
  onSubmit,
}: {
  formKey: number;
  server: ServerProfile;
  submitted: ProfileOutput | null;
  onSubmit: (values: ProfileOutput) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <ProfileForm
        key={`${formKey}:${server.revision}`}
        server={server}
        onSubmit={onSubmit}
        storage={draftStorage}
        maxAgeMs={DRAFT_MAX_AGE_MS}
      />
      <DraftInspector
        key={formKey}
        revision={server.revision}
      />
      {submitted && (
        <pre className="overflow-x-auto border bg-muted p-3 text-xs">
          {JSON.stringify(submitted, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;

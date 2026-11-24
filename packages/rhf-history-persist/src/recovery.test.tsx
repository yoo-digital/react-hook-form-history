import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useFormHistory } from '@yoo-digital/rhf-history';
import { diff, createHistory } from '@yoo-digital/rhf-history/core';
import type { JSX } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { HistoryToolbar } from '../test/fixtures/HistoryToolbar';
import {
  createMemoryStorage,
  type DraftKey,
  type FormHistoryStorage,
  type PersistedFormHistory,
  type RevisionKey,
} from './storage';
import { usePersistedFormHistory } from './usePersistedFormHistory';

const VERSION = 1;
const OLD = { name: 'old', email: '' };

function staleDraft(): PersistedFormHistory {
  const values = { name: 'old', email: 'mine@example.com' };
  return {
    version: VERSION,
    savedAt: 1,
    base: OLD,
    values,
    history: { ...createHistory(), past: [{ patches: diff(OLD, values) }] },
  };
}

type SpyStorage = FormHistoryStorage & {
  load: Mock<FormHistoryStorage['load']>;
  listRevisions: Mock<FormHistoryStorage['listRevisions']>;
};

function spyStorage(base: FormHistoryStorage = createMemoryStorage()): SpyStorage {
  return {
    ...base,
    load: vi.fn<FormHistoryStorage['load']>(base.load),
    listRevisions: vi.fn<FormHistoryStorage['listRevisions']>(base.listRevisions),
  } satisfies FormHistoryStorage;
}

function RevisionForm({
  storage,
  draftKey,
}: {
  storage: FormHistoryStorage;
  draftKey: DraftKey;
}): JSX.Element {
  const form = useForm({ defaultValues: { name: 'server', email: '' } });
  const history = useFormHistory(form);
  const { recovery, status } = usePersistedFormHistory(form, history, {
    storage,
    key: draftKey,
    version: VERSION,
  });
  return (
    <form>
      <HistoryToolbar
        history={history}
        control={form.control}
      />
      <input
        aria-label="Name"
        {...form.register('name')}
      />
      <input
        aria-label="Email"
        {...form.register('email')}
      />
      <output>{status}</output>
      {recovery && (
        <dialog open>
          <p>Recover {recovery.revision}</p>
          <button
            type="button"
            onClick={() => recovery.accept().catch(() => {})}
          >
            Recover
          </button>
          <button
            type="button"
            onClick={() => recovery.discard().catch(() => {})}
          >
            Discard
          </button>
        </dialog>
      )}
    </form>
  );
}

const key = (revision: string): RevisionKey => ({ scope: 'u1', document: 'doc', revision });

async function setup(
  draftKey: DraftKey = key('r2'),
): Promise<{ storage: SpyStorage; view: RenderResult; user: UserEvent }> {
  const storage = spyStorage();
  await storage.save(key('r1'), staleDraft());
  const view = render(
    <RevisionForm
      storage={storage}
      draftKey={draftKey}
    />,
  );
  return { storage, view, user: userEvent.setup() };
}

describe('usePersistedFormHistory recovery', () => {
  it('should expose the stale draft as recovery when a newer revision is opened', async () => {
    await setup();

    expect(await screen.findByRole('dialog')).toHaveTextContent('Recover r1');
    expect(screen.getByLabelText('Name')).toHaveValue('server');
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('should merge the draft, clear recovery and undo to the server values when accepting', async () => {
    const { user } = await setup();

    await user.click(await screen.findByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Email')).toHaveValue('mine@example.com');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('should leave the form untouched and clear recovery when discarding', async () => {
    const { user, storage } = await setup();

    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(await storage.listRevisions('u1', 'doc')).toEqual([]);
  });

  it('should not offer a recovery after a remount when the candidate was discarded', async () => {
    const { user, view, storage } = await setup();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    view.unmount();
    render(
      <RevisionForm
        storage={storage}
        draftKey={key('r2')}
      />,
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('fresh'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should clear recovery when accept rejects because the draft is gone', async () => {
    const { user, storage } = await setup();
    await screen.findByRole('dialog');
    await storage.removeRevisions('u1', 'doc');

    await user.click(screen.getByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('should offer no recovery and list no revisions when the key is a string', async () => {
    const { storage } = await setup('profile');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('fresh'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(storage.listRevisions).not.toHaveBeenCalled();
  });

  it('should not re-initialise when the key is a new object with the same content', async () => {
    const { storage, view } = await setup();
    await screen.findByRole('dialog');
    const loads = storage.load.mock.calls.length;

    view.rerender(
      <RevisionForm
        storage={storage}
        draftKey={key('r2')}
      />,
    );
    await act(async () => {});

    expect(storage.load.mock.calls.length).toBe(loads);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should re-initialise when a string key equals the JSON of the revision key', async () => {
    const { storage, view } = await setup();
    await screen.findByRole('dialog');
    const loads = storage.load.mock.calls.length;

    view.rerender(
      <RevisionForm
        storage={storage}
        draftKey={JSON.stringify(['u1', 'doc', 'r2'])}
      />,
    );

    await waitFor(() => expect(storage.load.mock.calls.length).toBeGreaterThan(loads));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

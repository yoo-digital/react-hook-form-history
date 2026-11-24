import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '../test/fixtures/ProfileForm';
import type { ProfileOutput } from '../test/fixtures/schema';
import { createIndexedDbStorage } from './indexedDbStorage';
import type { FormHistoryStorage } from './storage';

/** Renders the form against a shared IndexedDB; `reload()` unmounts and mounts a fresh instance. */
function setup({ maxAgeMs }: { maxAgeMs?: number } = {}): {
  user: UserEvent;
  storage: FormHistoryStorage;
  reload: () => void;
  name: () => HTMLElement;
  email: () => HTMLElement;
  undoButton: () => HTMLElement;
  redoButton: () => HTMLElement;
} {
  const storage = createIndexedDbStorage({ indexedDB: new IDBFactory() });
  const user = userEvent.setup();
  const onSubmit = vi.fn<(values: ProfileOutput) => void>();
  const form = (): JSX.Element => (
    <ProfileForm
      onSubmit={onSubmit}
      storage={storage}
      maxAgeMs={maxAgeMs}
    />
  );
  let view = render(form());

  return {
    user,
    storage,
    reload: () => {
      view.unmount();
      view = render(form());
    },
    name: () => screen.getByLabelText('Name'),
    email: () => screen.getByLabelText('Email'),
    undoButton: () => screen.getByRole('button', { name: 'Undo' }),
    redoButton: () => screen.getByRole('button', { name: 'Redo' }),
  };
}

describe('ProfileForm draft persistence', () => {
  it('should restore values and undo history when the page is reloaded', async () => {
    const { user, reload, name, email, undoButton, redoButton } = setup();
    await user.type(name(), 'Alice');
    await user.type(email(), 'alice@example.com');
    await user.click(undoButton());

    reload();

    expect(await screen.findByText(/Restored your unsaved draft/)).toBeInTheDocument();
    expect(name()).toHaveValue('Alice');
    expect(email()).toHaveValue('');
    expect(screen.getByText(/1 undo · 1 redo/)).toBeInTheDocument();

    await user.click(redoButton());
    expect(email()).toHaveValue('alice@example.com');
    await user.click(undoButton());
    await user.click(undoButton());
    expect(name()).toHaveValue('');
  });

  it('should restore field array rows when the page is reloaded', async () => {
    const { user, reload } = setup();
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.type(screen.getByLabelText('Skill 2'), 'React');

    reload();

    await screen.findByText(/Restored your unsaved draft/);
    expect(screen.getByLabelText('Skill 2')).toHaveValue('React');
  });

  it('should start fresh when the draft is discarded before reloading', async () => {
    const { user, reload, name, storage } = setup();
    await user.type(name(), 'Alice');
    reload();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(name()).toHaveValue('');
    expect(screen.getByText(/0 undo · 0 redo/)).toBeInTheDocument();
    await waitFor(async () => expect(await storage.load('profile')).toBeUndefined());

    reload();
    await waitFor(async () => expect(await storage.load('profile')).toBeUndefined());
    expect(screen.queryByText(/Restored your unsaved draft/)).not.toBeInTheDocument();
    expect(name()).toHaveValue('');
  });

  it('should drop the draft when the form is submitted successfully', async () => {
    const { user, name, email, storage } = setup();
    await user.type(name(), 'Alice');
    await user.type(email(), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText(/0 undo · 0 redo/)).toBeInTheDocument());
    await waitFor(async () => expect(await storage.load('profile')).toBeUndefined());
  });

  it('should discard the draft when it is older than maxAgeMs on reload', async () => {
    const day = 24 * 60 * 60 * 1000;
    const { user, reload, name, storage } = setup({ maxAgeMs: day });
    await user.type(name(), 'Alice');
    await waitFor(async () => expect(await storage.load('profile')).toBeDefined());
    const savedAt = (await storage.load('profile'))!.savedAt;
    vi.spyOn(Date, 'now').mockReturnValue(savedAt + day + 1);

    try {
      reload();
      await waitFor(async () => expect(await storage.load('profile')).toBeUndefined());
      expect(screen.queryByText(/Restored your unsaved draft/)).not.toBeInTheDocument();
      expect(name()).toHaveValue('');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('should restore the draft when it is younger than maxAgeMs on reload', async () => {
    const day = 24 * 60 * 60 * 1000;
    const { user, reload, name, storage } = setup({ maxAgeMs: day });
    await user.type(name(), 'Alice');
    await waitFor(async () => expect(await storage.load('profile')).toBeDefined());
    const savedAt = (await storage.load('profile'))!.savedAt;
    vi.spyOn(Date, 'now').mockReturnValue(savedAt + day - 1);

    try {
      reload();
      expect(await screen.findByText(/Restored your unsaved draft/)).toBeInTheDocument();
      expect(name()).toHaveValue('Alice');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('should not restore anything when there is no saved draft', async () => {
    const { reload, name, storage } = setup();

    reload();

    await waitFor(async () => expect(await storage.load('profile')).toBeUndefined());
    expect(screen.queryByText(/Restored your unsaved draft/)).not.toBeInTheDocument();
    expect(name()).toHaveValue('');
  });
});

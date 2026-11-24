import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { draftStorage } from './drafts';
import { readServerProfile, resetServerProfile } from './form/fakeServer';

const SERVER_NAME = 'Server edit r2';

/** Edits the name and email, then moves the server to r2 (which also changes the name). */
async function editThenSimulateRevision(user: UserEvent): Promise<void> {
  await user.type(screen.getByLabelText('Name'), 'Alice');
  await user.type(screen.getByLabelText('Email'), 'alice@example.com');
  await user.click(screen.getByRole('button', { name: 'Simulate new server revision' }));
}

describe('draft recovery', () => {
  beforeEach(async () => {
    resetServerProfile();
    await draftStorage.clearAll();
  });

  it('should list the clean change and the conflict when the server revision changes under an edited form', async () => {
    const user = userEvent.setup();
    render(<App />);

    await editThenSimulateRevision(user);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Changes that apply cleanly')).toBeInTheDocument();
    expect(within(dialog).getByText('email')).toBeInTheDocument();
    expect(within(dialog).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('Conflicts')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Resolve name' })).toBeInTheDocument();
    expect(within(dialog).getByText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue(SERVER_NAME);
  });

  it('should return to the server values with one undo when the draft is recovered', async () => {
    const user = userEvent.setup();
    render(<App />);
    await editThenSimulateRevision(user);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }));
    expect(within(dialog).getByRole('button', { name: 'Keep mine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toHaveValue('Alice');
    expect(screen.getByLabelText('Email')).toHaveValue('alice@example.com');
    expect(screen.getByText('1 undo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByLabelText('Name')).toHaveValue(SERVER_NAME);
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('should keep the server value when the conflict is left on "Keep server" and recovered', async () => {
    const user = userEvent.setup();
    render(<App />);
    await editThenSimulateRevision(user);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toHaveValue(SERVER_NAME);
    expect(screen.getByLabelText('Email')).toHaveValue('alice@example.com');
  });

  it('should leave the server values and show no dialog after a remount when the draft is discarded', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await editThenSimulateRevision(user);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toHaveValue(SERVER_NAME);
    expect(screen.getByLabelText('Email')).toHaveValue('');

    unmount();
    render(<App />);

    expect(await screen.findByLabelText('Name')).toHaveValue(SERVER_NAME);
    await waitFor(() => expect(screen.getByText('0 undo')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should bump the revision and show no dialog when the profile is saved', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Name'), 'Alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(readServerProfile().revision).toBe('r2'));
    expect(readServerProfile().values.name).toBe('Alice');
    expect(await screen.findByLabelText('Name')).toHaveValue('Alice');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

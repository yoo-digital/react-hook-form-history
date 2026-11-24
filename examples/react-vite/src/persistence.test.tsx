import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { draftStorage, profileDraftKey } from './drafts';
import { resetServerProfile } from './form/fakeServer';

const guestNames = (): string[] =>
  screen.getAllByLabelText(/^Guest \d+ name$/).map((input) => (input as HTMLInputElement).value);

describe('profile draft persistence', () => {
  beforeEach(async () => {
    resetServerProfile();
    await draftStorage.clearAll();
  });

  it('should restore nested booleans and a reordered field array with their undo history when the app remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByText('0 undo')).toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: 'Push notifications' }));
    await user.click(screen.getByRole('button', { name: 'Move guest 2 up' }));
    await user.click(screen.getAllByRole('checkbox', { name: 'Coming' })[0]);

    expect(guestNames()).toEqual(['Grace', 'Ada']);
    await waitFor(async () => {
      const record = await draftStorage.load(profileDraftKey('r1'));
      expect(record?.values.guests).toEqual([
        { name: 'Grace', coming: true },
        { name: 'Ada', coming: true },
      ]);
    });

    unmount();
    render(<App />);

    expect(await screen.findByText(/Restored your unsaved draft/)).toBeInTheDocument();
    expect(guestNames()).toEqual(['Grace', 'Ada']);
    expect(screen.getAllByRole('checkbox', { name: 'Coming' })[0]).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Push notifications' })).toBeChecked();
    expect(screen.getByText('3 undo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getAllByRole('checkbox', { name: 'Coming' })[0]).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(guestNames()).toEqual(['Ada', 'Grace']);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('checkbox', { name: 'Push notifications' })).not.toBeChecked();
  });

  it('should show the stored draft after an edit and nothing when the draft is discarded', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(await screen.findByText('nothing saved yet')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Push notifications' }));
    expect(await screen.findByText(/^saved .*, 1 undo entries$/)).toBeInTheDocument();

    unmount();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('nothing saved yet')).toBeInTheDocument();
  });
});

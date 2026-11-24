import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createIndexedDbStorage } from '@yoo-digital/rhf-history-persist/indexeddb';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { draftStorage } from './drafts';

// Reads the same database App writes to.
const storage = createIndexedDbStorage({ dbName: 'rfh-undo-redo' });

describe('App', () => {
  it('should delete every draft and remount a fresh form when "Clear all drafts" is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await storage.save('orphaned-form', {
      version: 1,
      savedAt: Date.now(),
      values: {},
      history: { past: [], future: [], group: null, updatedAt: 0 },
    });

    // Typed text is still pending in the debounce when the button is clicked.
    await user.type(screen.getByLabelText('Name'), 'Alice');
    await user.click(screen.getByRole('button', { name: 'Clear all drafts' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
    expect(screen.getByText('0 undo')).toBeInTheDocument();
    expect(screen.getByText('0 redo')).toBeInTheDocument();
    expect(await storage.load('profile')).toBeUndefined();
    expect(await storage.load('orphaned-form')).toBeUndefined();
  });

  it('should report the failure and keep the draft when clearing drafts fails', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Name'), 'Bob');
    const clearAll = vi.spyOn(draftStorage, 'clearAll').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await user.click(screen.getByRole('button', { name: 'Clear all drafts' }));

      expect(
        await screen.findByText('Drafts could not be deleted. Please try again.'),
      ).toBeInTheDocument();
      expect(await screen.findByText(/Restored your unsaved draft/)).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Bob');
      expect(screen.getByRole('button', { name: 'Clear all drafts' })).toBeEnabled();
      expect(clearAll).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

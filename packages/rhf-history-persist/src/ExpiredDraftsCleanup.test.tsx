import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '../test/fixtures/ProfileForm';
import { defaultProfile } from '../test/fixtures/schema';
import { ExpiredDraftsCleanup } from './ExpiredDraftsCleanup';
import { createMemoryStorage, type PersistedFormHistory } from './storage';

function makeRecord(
  savedAt: number,
  values: PersistedFormHistory['values'] = {},
): PersistedFormHistory {
  return { version: 1, savedAt, values, history: { past: [], future: [] } as never };
}

describe('ExpiredDraftsCleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should remove expired drafts and keep fresh ones when mounted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    const storage = createMemoryStorage();
    await storage.save('old', makeRecord(100));
    await storage.save('fresh', makeRecord(4500));

    render(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
      />,
    );

    await waitFor(() => expect(storage.load('old')).resolves.toBeUndefined());
    await expect(storage.load('fresh')).resolves.toBeDefined();
  });

  it('should render nothing when mounted', () => {
    const { container } = render(
      <ExpiredDraftsCleanup
        storage={createMemoryStorage()}
        maxAgeMs={1000}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should not prune again when re-rendered with the same props', async () => {
    const storage = createMemoryStorage();
    const spy = vi.spyOn(storage, 'removeOlderThan');

    const { rerender } = render(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
      />,
    );
    rerender(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
        onError={() => {}}
      />,
    );

    await waitFor(() => expect(spy.mock.results[0]?.value).resolves.toBe(0));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should not restore an expired draft when the cleanup mounts after the form', async () => {
    const day = 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(2 * day);
    const storage = createMemoryStorage();
    await storage.save('profile', makeRecord(0, { ...defaultProfile, name: 'Alice' }));

    render(
      <>
        <ProfileForm
          onSubmit={() => {}}
          storage={storage}
          maxAgeMs={day}
        />
        <ExpiredDraftsCleanup
          storage={storage}
          maxAgeMs={day}
        />
      </>,
    );

    await waitFor(() => expect(storage.load('profile')).resolves.toBeUndefined());
    expect(screen.queryByText(/Restored your unsaved draft/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('should pass the error to onError when pruning fails', async () => {
    const storage = createMemoryStorage();
    const error = new Error('blocked');
    vi.spyOn(storage, 'removeOlderThan').mockRejectedValue(error);
    const onError = vi.fn<(error: unknown) => void>();

    render(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(error));
  });

  it('should pass the error to onError when the storage throws synchronously', async () => {
    const storage = createMemoryStorage();
    const error = new Error('blocked');
    vi.spyOn(storage, 'removeOlderThan').mockImplementation(() => {
      throw error;
    });
    const onError = vi.fn<(error: unknown) => void>();

    render(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(error));
  });

  it('should log the error when pruning fails without onError', async () => {
    const storage = createMemoryStorage();
    vi.spyOn(storage, 'removeOlderThan').mockRejectedValue(new Error('blocked'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ExpiredDraftsCleanup
        storage={storage}
        maxAgeMs={1000}
      />,
    );

    await waitFor(() => expect(log).toHaveBeenCalledOnce());
  });
});

import { expect, test } from '@playwright/test';
import { inputValues, profile } from './profile';

test.describe('draft persistence', () => {
  test('should restore values and undo history when the page reloads', async ({ page }) => {
    const form = profile(page);
    await form.open();
    await expect(form.storedDraft).toHaveText('nothing saved yet');

    await form.name.fill('Alice');
    await form.checkbox('Push notifications').click();
    await page.getByRole('button', { name: 'Move guest 2 up' }).click();
    await form.expectStoredEntries(3);

    await page.reload();

    await expect(form.restoredAlert).toBeVisible();
    await expect(form.name).toHaveValue('Alice');
    await expect(form.checkbox('Push notifications')).toBeChecked();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Grace', 'Ada']);
    await form.expectCounts(3, 0);

    await form.undoButton.click();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Grace']);
    await form.undoButton.click();
    await expect(form.checkbox('Push notifications')).not.toBeChecked();
    await form.undoButton.click();
    await expect(form.name).toHaveValue('');
  });

  test('should keep the redo stack when the page reloads after an undo', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('Alice');
    await form.email.fill('alice@example.com');
    await form.undoButton.click();
    await expect(form.email).toHaveValue('');
    await form.expectStoredEntries(1);

    await page.reload();

    await expect(form.restoredAlert).toBeVisible();
    await form.expectCounts(1, 1);
    await form.redoButton.click();
    await expect(form.email).toHaveValue('alice@example.com');
  });

  // Known library bug: the IndexedDB adapter's `save` reads `meta.clearEpoch` and then puts in the
  // same transaction, and Chromium never runs that second step once the page unloads, so the save
  // issued on `pagehide` never commits. Expected to fail until that is fixed; it then flips to red.
  test.fail(
    'should save the latest edit when the page reloads before the debounced save',
    async ({ page }) => {
      const form = profile(page);
      await form.open();

      await form.name.fill('Alice');
      // No wait for the stored draft: the save on `pagehide` has to catch it.
      await page.reload();

      await expect(form.restoredAlert).toBeVisible();
      await expect(form.name).toHaveValue('Alice');
    },
  );

  test('should start from the server values after a reload when the draft is discarded', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();
    await form.name.fill('Alice');
    await form.expectStoredEntries(1);
    await page.reload();

    await form.restoredAlert.getByRole('button', { name: 'Discard' }).click();

    await expect(form.name).toHaveValue('');
    await form.expectCounts(0, 0);
    await expect(form.storedDraft).toHaveText('nothing saved yet');

    await page.reload();
    await expect(form.name).toHaveValue('');
    await expect(form.restoredAlert).toBeHidden();
    await form.expectCounts(0, 0);
  });

  test('should clear the draft and start a new revision when the profile is saved', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('Alice');
    await form.email.fill('alice@example.com');
    await form.expectStoredEntries(2);
    await form.save.click();

    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect(form.name).toHaveValue('Alice');
    await form.expectCounts(0, 0);
    await expect(form.storedDraft).toHaveText('nothing saved yet');

    await page.reload();
    await expect(form.storedDraft).toHaveText('nothing saved yet');
    await expect(form.name).toHaveValue('Alice');
    await expect(form.restoredAlert).toBeHidden();
    await expect(page.getByRole('dialog')).toBeHidden();
    await form.expectCounts(0, 0);
  });

  test('should list every stored undo entry when the stored-draft panel is opened', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('Alice');
    await form.checkbox('Weekly digest').click();
    await form.expectStoredEntries(2);
    await page.getByTestId('stored-draft').getByText('Stored draft').click();

    const panel = page.getByTestId('stored-draft');
    const entries = panel.getByRole('listitem');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveText('notifications.weeklyDigest false → true');
    await expect(entries.nth(1)).toHaveText('name "" → "Alice"');

    await form.undoButton.click();
    await form.expectStoredEntries(1);
    await expect(entries).toHaveCount(1);
  });
});

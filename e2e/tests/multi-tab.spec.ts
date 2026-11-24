import { expect, test } from '@playwright/test';
import { profile } from './profile';

// Two pages in one browser context share IndexedDB, like two tabs of the same site.
test.describe('drafts across tabs', () => {
  test('should not resurrect drafts in another tab when all drafts were cleared', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const formA = profile(tabA);
    const formB = profile(tabB);
    await formA.open();
    await formB.open();

    await formB.name.fill('Alice');
    await formB.expectStoredEntries(1);

    await tabA.getByRole('button', { name: 'Clear all drafts' }).click();
    await expect(formA.storedDraft).toHaveText('nothing saved yet');

    // Tab B still shows its edit and keeps editing, but must not write it back.
    await formB.email.fill('alice@example.com');
    await formB.expectCounts(2, 0);
    await tabB.getByRole('button', { name: 'Add skill' }).click();
    await formB.expectCounts(3, 0);

    await tabA.reload();
    await expect(formA.storedDraft).toHaveText('nothing saved yet');
    await expect(formA.restoredAlert).toBeHidden();

    await tabB.reload();
    await expect(formB.storedDraft).toHaveText('nothing saved yet');
    await expect(formB.restoredAlert).toBeHidden();
    await expect(formB.name).toHaveValue('');
    await expect(formB.email).toHaveValue('');
    await formB.expectCounts(0, 0);
  });

  test('should keep saving drafts in the tab that cleared them', async ({ context }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const formA = profile(tabA);
    const formB = profile(tabB);
    await formA.open();
    await formB.open();

    await tabA.getByRole('button', { name: 'Clear all drafts' }).click();
    await expect(formA.storedDraft).toHaveText('nothing saved yet');
    await formA.name.fill('Alice');
    await formA.expectStoredEntries(1);

    await tabA.reload();
    await expect(formA.restoredAlert).toBeVisible();
    await expect(formA.name).toHaveValue('Alice');

    // A tab opened after the clear sees the new draft, too.
    await tabB.reload();
    await expect(formB.restoredAlert).toBeVisible();
    await expect(formB.name).toHaveValue('Alice');
  });
});

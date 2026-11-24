import { expect, test, type Locator, type Page } from '@playwright/test';
import { profile, type ProfileForm } from './profile';

const SERVER_NAME = 'Server edit r2';

/** Edits name and email on r1, then moves the server to r2, which also changes the name. */
async function editThenSimulateRevision(
  page: Page,
): Promise<{ form: ProfileForm; dialog: Locator }> {
  const form = profile(page);
  await form.open();
  await form.name.fill('Alice');
  await form.email.fill('alice@example.com');
  await page.getByRole('button', { name: 'Simulate new server revision' }).click();
  return { form, dialog: page.getByRole('dialog', { name: 'Recover your unsaved changes?' }) };
}

test.describe('draft recovery', () => {
  test('should list the clean change and the conflict when the server revision changes under an edited form', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);

    await expect(dialog).toBeVisible();
    const applied = dialog.getByRole('region', { name: 'Changes that apply cleanly' });
    await expect(applied).toContainText('email');
    await expect(applied).toContainText('alice@example.com');
    const conflict = dialog.getByRole('group', { name: 'Resolve name' });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole('button', { name: 'Keep server' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(form.name).toHaveValue(SERVER_NAME);
  });

  test('should apply my value and return to the server version with one undo when "Keep mine" is recovered', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);

    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog.getByRole('button', { name: 'Keep mine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Recover' }).click();

    await expect(dialog).toBeHidden();
    await expect(form.name).toHaveValue('Alice');
    await expect(form.email).toHaveValue('alice@example.com');
    await form.expectCounts(1, 0);

    await form.name.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(form.name).toHaveValue(SERVER_NAME);
    await expect(form.email).toHaveValue('');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(form.name).toHaveValue('Alice');
    await expect(form.email).toHaveValue('alice@example.com');
  });

  test('should keep the server value when the conflict is left on "Keep server" and recovered', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);

    await dialog.getByRole('button', { name: 'Recover' }).click();

    await expect(dialog).toBeHidden();
    await expect(form.name).toHaveValue(SERVER_NAME);
    await expect(form.email).toHaveValue('alice@example.com');

    await form.email.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(form.email).toHaveValue('');
    await expect(form.name).toHaveValue(SERVER_NAME);
  });

  test('should keep the recovered draft on the new revision when the page reloads', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);
    await dialog.getByRole('button', { name: 'Recover' }).click();
    await expect(dialog).toBeHidden();
    await form.expectStoredEntries(1);

    await page.reload();

    await expect(form.restoredAlert).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(form.name).toHaveValue(SERVER_NAME);
    await expect(form.email).toHaveValue('alice@example.com');
    await form.expectCounts(1, 0);
  });

  test('should leave the server values and offer nothing after a reload when the draft is discarded', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);

    await dialog.getByRole('button', { name: 'Discard' }).click();

    await expect(dialog).toBeHidden();
    await expect(form.name).toHaveValue(SERVER_NAME);
    await expect(form.email).toHaveValue('');

    await page.reload();
    await expect(form.name).toHaveValue(SERVER_NAME);
    await form.expectCounts(0, 0);
    await expect(form.restoredAlert).toBeHidden();
    await expect(dialog).toBeHidden();
  });

  test('should offer recovery again when the page reloads with the dialog still open', async ({
    page,
  }) => {
    const { form, dialog } = await editThenSimulateRevision(page);
    await expect(dialog).toBeVisible();

    await page.reload();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Resolve name' })).toBeVisible();
    await expect(form.name).toHaveValue(SERVER_NAME);
  });
});

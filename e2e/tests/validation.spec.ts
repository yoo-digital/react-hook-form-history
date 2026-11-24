import { expect, test } from '@playwright/test';
import { profile } from './profile';

const NAME_ERROR = 'Name must be at least 2 characters';
const EMAIL_ERROR = 'Please enter a valid email';

test.describe('validation with undo', () => {
  test('should show no errors when edits are undone before the first submit', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('A');
    await form.email.fill('not-an-email');
    await form.undoButton.click();
    await form.undoButton.click();
    await form.redoButton.click();

    await expect(form.email).toHaveValue('');
    await expect(form.name).toHaveValue('A');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('should bring back the error when the fix is undone after a failed submit', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.save.click();
    await expect(page.getByText(NAME_ERROR)).toBeVisible();
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(form.name).toHaveAttribute('aria-invalid', 'true');

    await form.name.fill('Alice');
    await expect(page.getByText(NAME_ERROR)).toBeHidden();
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();

    await form.undoButton.click();
    await expect(form.name).toHaveValue('');
    await expect(page.getByText(NAME_ERROR)).toBeVisible();
    await expect(form.name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();

    await form.redoButton.click();
    await expect(form.name).toHaveValue('Alice');
    await expect(page.getByText(NAME_ERROR)).toBeHidden();
    await expect(form.name).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
  });

  test('should clear an error when undo restores a valid value after a failed submit', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();
    await form.name.fill('Alice');
    await form.email.fill('alice@example.com');

    await page.getByLabel('Skill 1', { exact: true }).fill('');
    await form.save.click();
    await expect(page.getByText('Skill cannot be empty')).toBeVisible();
    await expect(page.getByText('Profile saved')).toBeHidden();

    await form.undoButton.click();
    await expect(page.getByLabel('Skill 1', { exact: true })).toHaveValue('TypeScript');
    await expect(page.getByText('Skill cannot be empty')).toBeHidden();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await form.save.click();
    await expect(page.getByText('Profile saved')).toBeVisible();
  });

  test('should only re-validate the undone field when other fields are still invalid', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.save.click();
    await expect(page.getByRole('alert')).toHaveCount(2);

    // Guest 1 is untouched and valid; breaking and restoring it must leave the other errors alone.
    await form.guestNames.nth(0).fill('');
    await expect(page.getByText('Guest name cannot be empty')).toBeVisible();
    await form.undoButton.click();

    await expect(form.guestNames.nth(0)).toHaveValue('Ada');
    await expect(page.getByText('Guest name cannot be empty')).toBeHidden();
    await expect(page.getByText(NAME_ERROR)).toBeVisible();
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(2);
  });
});

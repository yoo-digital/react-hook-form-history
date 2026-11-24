import { expect, test } from '@playwright/test';
import { profile } from './profile';

test.describe('undo and redo', () => {
  test('should disable both buttons when nothing was edited', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.expectCounts(0, 0);
    await expect(form.undoButton).toBeDisabled();
    await expect(form.redoButton).toBeDisabled();
  });

  test('should undo and redo an edit when the toolbar buttons are clicked', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('Alice');
    await form.expectCounts(1, 0);
    await expect(form.undoButton).toBeEnabled();

    await form.undoButton.click();
    await expect(form.name).toHaveValue('');
    await form.expectCounts(0, 1);
    await expect(form.undoButton).toBeDisabled();
    await expect(form.redoButton).toBeEnabled();

    await form.redoButton.click();
    await expect(form.name).toHaveValue('Alice');
    await form.expectCounts(1, 0);
    await expect(form.redoButton).toBeDisabled();
  });

  test('should merge keystrokes into one entry when typing in the same field', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.pressSequentially('Alice');
    await form.expectCounts(1, 0);

    await form.undoButton.click();
    await expect(form.name).toHaveValue('');
  });

  test('should record separate entries when two fields are edited', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.pressSequentially('Alice');
    await form.email.pressSequentially('alice@example.com');
    await form.expectCounts(2, 0);

    await form.undoButton.click();
    await expect(form.email).toHaveValue('');
    await expect(form.name).toHaveValue('Alice');
  });

  test('should undo with Mod+Z and redo with Mod+Shift+Z when a field has focus', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.name.pressSequentially('Alice');
    await form.email.pressSequentially('alice@example.com');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(form.email).toHaveValue('');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(form.name).toHaveValue('');
    await form.expectCounts(0, 2);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(form.name).toHaveValue('Alice');
    await expect(form.email).toHaveValue('');
    await form.expectCounts(1, 1);
  });

  test('should redo with Ctrl+Y when a field has focus', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.pressSequentially('Alice');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(form.name).toHaveValue('');

    await page.keyboard.press('Control+y');
    await expect(form.name).toHaveValue('Alice');
    await form.expectCounts(1, 0);
  });

  test('should undo the whole form instead of the focused input when Mod+Z is pressed', async ({
    page,
  }) => {
    const form = profile(page);
    await form.open();

    await form.name.pressSequentially('Alice');
    // Focus stays in email, but the newest change is the name: the form-level undo wins.
    await form.email.focus();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(form.name).toHaveValue('');
    await expect(form.email).toBeFocused();
  });

  test('should drop the redo stack when a new edit follows an undo', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await form.name.fill('Alice');
    await form.email.fill('alice@example.com');
    await form.undoButton.click();
    await form.expectCounts(1, 1);

    await form.name.fill('Bob');
    await form.expectCounts(2, 0);
    await expect(form.redoButton).toBeDisabled();
  });
});

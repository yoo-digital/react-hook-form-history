import { expect, test } from '@playwright/test';
import { inputValues, profile } from './profile';

test.describe('field arrays and nested booleans', () => {
  test('should undo and redo adding a skill when "Add skill" is clicked', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await page.getByRole('button', { name: 'Add skill' }).click();
    await page.getByLabel('Skill 3', { exact: true }).fill('Rust');
    await expect(form.skills).toHaveCount(3);
    await form.expectCounts(2, 0);

    await form.undoButton.click();
    await expect(page.getByLabel('Skill 3', { exact: true })).toHaveValue('');
    await form.undoButton.click();
    await expect(form.skills).toHaveCount(2);

    await form.redoButton.click();
    await form.redoButton.click();
    await expect(form.skills).toHaveCount(3);
    await expect(page.getByLabel('Skill 3', { exact: true })).toHaveValue('Rust');
  });

  test('should restore the removed skill when a removal is undone', async ({ page }) => {
    const form = profile(page);
    await form.open();

    await page.getByRole('button', { name: 'Remove skill 1' }).click();
    await expect(form.skills).toHaveCount(1);
    await expect(form.skills.first()).toHaveValue('React');

    await form.undoButton.click();
    await expect(form.skills).toHaveCount(2);
    await expect(form.skills.nth(0)).toHaveValue('TypeScript');
    await expect(form.skills.nth(1)).toHaveValue('React');

    await form.redoButton.click();
    await expect(form.skills).toHaveCount(1);
    await expect(form.skills.first()).toHaveValue('React');
  });

  test('should restore the original order when moving skills is undone', async ({ page }) => {
    const form = profile(page);
    await form.open();
    await expect(page.getByRole('button', { name: 'Move skill 1 up' })).toBeDisabled();

    await page.getByRole('button', { name: 'Move skill 1 down' }).click();
    await expect(form.skills.nth(0)).toHaveValue('React');
    await expect(form.skills.nth(1)).toHaveValue('TypeScript');
    await form.expectCounts(1, 0);

    await form.undoButton.click();
    await expect(form.skills.nth(0)).toHaveValue('TypeScript');
    await expect(form.skills.nth(1)).toHaveValue('React');

    await form.redoButton.click();
    await expect(form.skills.nth(0)).toHaveValue('React');
  });

  test('should step back through guest edits one at a time when undone', async ({ page }) => {
    const form = profile(page);
    await form.open();
    const summary = page.getByText(/^\d+ of \d+ coming$/);
    await expect(summary).toHaveText('1 of 2 coming');

    await page.getByRole('button', { name: 'Add guest' }).click();
    await page.getByLabel('Guest 3 name', { exact: true }).fill('Linus');
    await page.getByRole('button', { name: 'Move guest 3 up' }).click();
    await form.coming.nth(0).click();
    await page.getByRole('button', { name: 'Remove guest 3' }).click();

    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Linus']);
    await expect(summary).toHaveText('1 of 2 coming');
    await form.expectCounts(5, 0);

    await form.undoButton.click();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Linus', 'Grace']);
    await form.undoButton.click();
    await expect(form.coming.nth(0)).toBeChecked();
    await expect(summary).toHaveText('2 of 3 coming');
    await form.undoButton.click();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Grace', 'Linus']);
    await form.undoButton.click();
    await expect(form.guestNames.nth(2)).toHaveValue('');
    await form.undoButton.click();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Grace']);
    await expect(form.coming).toHaveCount(2);
    await expect(form.coming.nth(0)).toBeChecked();
    await expect(form.coming.nth(1)).not.toBeChecked();
    await form.expectCounts(0, 5);

    for (let step = 0; step < 5; step++) await form.redoButton.click();
    await expect.poll(() => inputValues(form.guestNames)).toEqual(['Ada', 'Linus']);
    await expect(form.coming.nth(0)).not.toBeChecked();
    await expect(form.coming.nth(1)).toBeChecked();
  });

  test('should record each nested boolean toggle as its own undo step', async ({ page }) => {
    const form = profile(page);
    await form.open();
    const email = form.checkbox('Email updates');
    const push = form.checkbox('Push notifications');
    const digest = form.checkbox('Weekly digest');

    await push.click();
    await digest.click();
    await email.click();
    await form.expectCounts(3, 0);
    await expect(email).not.toBeChecked();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(email).toBeChecked();
    await expect(digest).toBeChecked();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(digest).not.toBeChecked();
    await expect(push).toBeChecked();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(push).not.toBeChecked();
    await form.expectCounts(0, 3);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(push).toBeChecked();
    await expect(digest).not.toBeChecked();
  });
});

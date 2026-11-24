import { expect, test, type Locator, type Page } from '@playwright/test';
import { profile, type ProfileForm } from './profile';

type LargeForm = {
  form: ProfileForm;
  label: (row: number) => Locator;
  amount: (row: number) => Locator;
  note: (row: number) => Locator;
};

/** Opens the Large form tab and picks the biggest row count the demo offers. */
async function openLargeForm(page: Page): Promise<LargeForm> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Large form' }).click();
  await page.getByRole('combobox', { name: 'Rows' }).click();
  await page.getByRole('option', { name: /^5,000 rows/ }).click();
  await expect(page.getByLabel('Label 5000', { exact: true })).toBeAttached();
  const form = profile(page);
  await form.expectCounts(0, 0);
  return {
    form,
    label: (row) => page.getByLabel(`Label ${row}`, { exact: true }),
    amount: (row) => page.getByLabel(`Amount ${row}`, { exact: true }),
    note: (row) => page.getByLabel(`Note ${row}`, { exact: true }),
  };
}

test.describe('large form', () => {
  test('should undo and redo an edit far down the list when the largest row count is shown', async ({
    page,
  }) => {
    const { form, label } = await openLargeForm(page);

    await label(4999).fill('Edited');
    await form.expectCounts(1, 0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(label(4999)).toHaveValue('Row 4999');
    await form.expectCounts(0, 1);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(label(4999)).toHaveValue('Edited');
    await expect(label(1)).toHaveValue('Row 1');
    await expect(label(5000)).toHaveValue('Row 5000');
    await form.expectCounts(1, 0);
  });

  test('should undo edits in different rows in reverse order when undo is clicked repeatedly', async ({
    page,
  }) => {
    const { form, label, amount, note } = await openLargeForm(page);

    await label(1).fill('First');
    await note(2500).fill('Middle');
    await amount(5000).fill('42');
    await form.expectCounts(3, 0);

    await form.undoButton.click();
    await expect(amount(5000)).toHaveValue('0');
    await expect(note(2500)).toHaveValue('Middle');
    await form.undoButton.click();
    await expect(note(2500)).toHaveValue('');
    await expect(label(1)).toHaveValue('First');
    await form.undoButton.click();
    await expect(label(1)).toHaveValue('Row 1');
    await form.expectCounts(0, 3);
  });

  test('should update the error summary when an invalid edit is undone after validating', async ({
    page,
  }) => {
    const { form, amount } = await openLargeForm(page);
    const summary = page.getByRole('alert').filter({ hasText: 'row(s) invalid' });

    await amount(4000).fill('abc');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(summary).toHaveText('1 row(s) invalid');

    await form.undoButton.click();
    await expect(amount(4000)).toHaveValue('0');
    await expect(summary).toBeHidden();

    await form.redoButton.click();
    await expect(amount(4000)).toHaveValue('abc');
    await expect(summary).toHaveText('1 row(s) invalid');
  });

  test('should start with an empty history when the row count changes', async ({ page }) => {
    const { form, label } = await openLargeForm(page);
    await label(10).fill('Edited');
    await form.expectCounts(1, 0);

    await page.getByRole('combobox', { name: 'Rows' }).click();
    await page.getByRole('option', { name: /^100 rows/ }).click();

    await expect(page.getByLabel('Label 100', { exact: true })).toBeAttached();
    await expect(page.getByLabel('Label 101', { exact: true })).not.toBeAttached();
    await expect(label(10)).toHaveValue('Row 10');
    await form.expectCounts(0, 0);
  });
});

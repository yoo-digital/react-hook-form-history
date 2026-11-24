import { expect, type Locator, type Page } from '@playwright/test';

export type ProfileForm = {
  name: Locator;
  email: Locator;
  undoButton: Locator;
  redoButton: Locator;
  save: Locator;
  checkbox: (name: string) => Locator;
  skills: Locator;
  guestNames: Locator;
  coming: Locator;
  restoredAlert: Locator;
  storedDraft: Locator;
  /** Opens the demo and waits until the draft restore attempt has finished. */
  open: () => Promise<void>;
  /** Asserts the toolbar's undo and redo counters. */
  expectCounts: (undo: number, redo: number) => Promise<void>;
  /** Waits until IndexedDB holds a draft with `count` undo entries. */
  expectStoredEntries: (count: number) => Promise<void>;
};

/** Locators and assertions for the demo's profile form. */
export function profile(page: Page): ProfileForm {
  const toolbar = page.getByRole('toolbar', { name: 'History' });
  const storedDraft = page.getByTestId('stored-draft-status');

  return {
    name: page.getByLabel('Name', { exact: true }),
    email: page.getByLabel('Email', { exact: true }),
    undoButton: toolbar.getByRole('button', { name: 'Undo' }),
    redoButton: toolbar.getByRole('button', { name: 'Redo' }),
    save: page.getByRole('button', { name: 'Save' }),
    checkbox: (name: string): Locator => page.getByRole('checkbox', { name, exact: true }),
    skills: page.getByLabel(/^Skill \d+$/),
    guestNames: page.getByLabel(/^Guest \d+ name$/),
    coming: page.getByRole('checkbox', { name: 'Coming', exact: true }),
    restoredAlert: page.getByRole('status').filter({ hasText: 'Restored your unsaved draft' }),
    storedDraft,

    async open(): Promise<void> {
      await page.goto('/');
      await expect(storedDraft).not.toHaveText('loading…');
    },

    async expectCounts(undo: number, redo: number): Promise<void> {
      await expect(toolbar.getByText(/^\d+ undo$/)).toHaveText(`${undo} undo`);
      await expect(toolbar.getByText(/^\d+ redo$/)).toHaveText(`${redo} redo`);
    },

    async expectStoredEntries(count: number): Promise<void> {
      await expect(storedDraft).toHaveText(new RegExp(`^saved .*, ${count} undo entries$`));
    },
  };
}

/** Current values of every input `inputs` matches, in DOM order. */
export const inputValues = (inputs: Locator): Promise<string[]> =>
  inputs.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));

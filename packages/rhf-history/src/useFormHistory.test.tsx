import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ProfileForm } from '../test/fixtures/ProfileForm';
import type { ProfileOutput } from '../test/fixtures/schema';

function setup(): {
  user: UserEvent;
  onSubmit: Mock<(values: ProfileOutput) => void>;
  name: () => HTMLInputElement;
  email: () => HTMLInputElement;
  role: () => HTMLSelectElement;
  newsletter: () => HTMLInputElement;
  skillInputs: () => HTMLInputElement[];
  undoButton: () => HTMLElement;
  redoButton: () => HTMLElement;
  status: () => HTMLElement;
} {
  const onSubmit = vi.fn<(values: ProfileOutput) => void>();
  const user = userEvent.setup();
  render(<ProfileForm onSubmit={onSubmit} />);
  return {
    user,
    onSubmit,
    name: () => screen.getByLabelText('Name') as HTMLInputElement,
    email: () => screen.getByLabelText('Email') as HTMLInputElement,
    role: () => screen.getByLabelText('Role') as HTMLSelectElement,
    newsletter: () => screen.getByLabelText('Subscribe to newsletter') as HTMLInputElement,
    skillInputs: () => screen.queryAllByLabelText(/^Skill \d+$/) as HTMLInputElement[],
    undoButton: () => screen.getByRole('button', { name: 'Undo' }),
    redoButton: () => screen.getByRole('button', { name: 'Redo' }),
    status: () => screen.getByText(/undo ·/),
  };
}

describe('useFormHistory', () => {
  it('should disable undo and redo when nothing has changed', () => {
    const { undoButton, redoButton } = setup();

    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
  });

  it('should undo and redo a text change when the buttons are clicked', async () => {
    const { user, name, undoButton, redoButton } = setup();

    await user.type(name(), 'Alice');
    await user.click(undoButton());
    expect(name()).toHaveValue('');

    await user.click(redoButton());
    expect(name()).toHaveValue('Alice');
  });

  it('should coalesce consecutive keystrokes in one field into a single step', async () => {
    const { user, name, undoButton } = setup();

    await user.type(name(), 'Alice');
    await user.click(undoButton());

    expect(name()).toHaveValue('');
    expect(undoButton()).toBeDisabled();
  });

  it('should create separate steps when different fields are edited', async () => {
    const { user, name, email, undoButton } = setup();

    await user.type(name(), 'Alice');
    await user.type(email(), 'a@b.co');
    await user.click(undoButton());

    expect(email()).toHaveValue('');
    expect(name()).toHaveValue('Alice');
  });

  it('should start a new step when the same field is edited again after blur', async () => {
    const { user, name, undoButton } = setup();

    await user.type(name(), 'Al');
    await user.tab();
    await user.type(name(), 'ice');
    await user.click(undoButton());

    expect(name()).toHaveValue('Al');
  });

  it('should start a new step when the same field is edited after the merge window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ProfileForm onSubmit={vi.fn<(values: ProfileOutput) => void>()} />);
      const name = screen.getByLabelText('Name');

      await user.type(name, 'Al');
      vi.advanceTimersByTime(1_000);
      await user.type(name, 'ice');
      await user.click(screen.getByRole('button', { name: 'Undo' }));

      expect(name).toHaveValue('Al');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should undo select and checkbox changes when they are changed', async () => {
    const { user, role, newsletter, undoButton } = setup();

    await user.selectOptions(role(), 'designer');
    await user.click(newsletter());

    await user.click(undoButton());
    expect(newsletter()).not.toBeChecked();
    expect(role()).toHaveValue('designer');

    await user.click(undoButton());
    expect(role()).toHaveValue('developer');
  });

  it('should undo field array changes when items are added and edited', async () => {
    const { user, skillInputs, undoButton, redoButton } = setup();
    const addSkill = screen.getByRole('button', { name: 'Add skill' });

    await user.click(addSkill);
    await user.type(skillInputs()[1], 'React');
    expect(skillInputs().map((input) => input.value)).toEqual(['TypeScript', 'React']);

    await user.click(undoButton());
    expect(skillInputs().map((input) => input.value)).toEqual(['TypeScript', '']);

    await user.click(undoButton());
    expect(skillInputs().map((input) => input.value)).toEqual(['TypeScript']);

    await user.click(redoButton());
    await user.click(redoButton());
    expect(skillInputs().map((input) => input.value)).toEqual(['TypeScript', 'React']);
  });

  it('should restore a removed field array item when removal is undone', async () => {
    const { user, skillInputs, undoButton } = setup();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(skillInputs()).toHaveLength(0);

    await user.click(undoButton());
    expect(skillInputs().map((input) => input.value)).toEqual(['TypeScript']);
  });

  it('should discard the redo stack when a new change is made after undo', async () => {
    const { user, name, email, undoButton, redoButton } = setup();

    await user.type(name(), 'Alice');
    await user.type(email(), 'a@b.co');
    await user.click(undoButton());
    expect(redoButton()).toBeEnabled();

    await user.type(name(), 'x');
    expect(redoButton()).toBeDisabled();
  });

  it('should not record undo or redo itself as a new step when applying history', async () => {
    const { user, name, undoButton, status } = setup();

    await user.type(name(), 'Alice');
    expect(status()).toHaveTextContent('1 undo · 0 redo');

    await user.click(undoButton());
    expect(status()).toHaveTextContent('0 undo · 1 redo');
  });

  it('should report the form as pristine when all changes are undone', async () => {
    const { user, name, undoButton, status } = setup();

    await user.type(name(), 'Alice');
    expect(status()).toHaveTextContent('unsaved changes');

    await user.click(undoButton());
    expect(status()).not.toHaveTextContent('unsaved changes');
  });

  it('should undo and redo via keyboard shortcuts when focus is inside the form', async () => {
    const { user, name } = setup();

    await user.type(name(), 'Alice');
    await user.keyboard('{Control>}z{/Control}');
    expect(name()).toHaveValue('');

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(name()).toHaveValue('Alice');

    await user.keyboard('{Control>}z{/Control}');
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    expect(name()).toHaveValue('Alice');

    await user.keyboard('{Meta>}z{/Meta}');
    await user.keyboard('{Control>}y{/Control}');
    expect(name()).toHaveValue('Alice');
  });

  it('should revalidate restored values when the form was already submitted', async () => {
    const { user, name, email, undoButton, onSubmit } = setup();

    await user.type(email(), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();

    await user.type(name(), 'Alice');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    await user.click(undoButton());
    expect(name()).toHaveValue('');
    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should submit the redone values when the form is submitted after redo', async () => {
    const { user, name, email, undoButton, redoButton, onSubmit } = setup();

    await user.type(name(), 'Alice');
    await user.type(email(), 'alice@example.com');
    await user.click(undoButton());
    await user.click(redoButton());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      role: 'developer',
      newsletter: false,
      skills: [{ label: 'TypeScript' }],
    });
  });
});

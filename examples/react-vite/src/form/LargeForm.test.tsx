import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProfilerOnRenderCallback } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LargeForm } from './LargeForm';

function renderLargeForm(): Mock<ProfilerOnRenderCallback> {
  const onFieldsRender = vi.fn<ProfilerOnRenderCallback>();
  render(
    <TooltipProvider>
      <LargeForm
        rowCount={20}
        onFieldsRender={onFieldsRender}
      />
    </TooltipProvider>,
  );
  return onFieldsRender;
}

describe('LargeForm', () => {
  it('should not re-render the field list when typing into a field', async () => {
    const user = userEvent.setup();
    const onFieldsRender = renderLargeForm();
    const rendersAfterMount = onFieldsRender.mock.calls.length;

    await user.type(screen.getByLabelText('Note 3'), 'hello');

    expect(screen.getByText('1 undo')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(onFieldsRender).toHaveBeenCalledTimes(rendersAfterMount);
  });

  it('should not re-render the field list when undoing and redoing', async () => {
    const user = userEvent.setup();
    const onFieldsRender = renderLargeForm();
    await user.type(screen.getByLabelText('Note 3'), 'hello');
    const rendersAfterTyping = onFieldsRender.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByLabelText('Note 3')).toHaveValue(''));
    expect(screen.getByText('1 redo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(screen.getByLabelText('Note 3')).toHaveValue('hello'));

    expect(onFieldsRender).toHaveBeenCalledTimes(rendersAfterTyping);
  });
});

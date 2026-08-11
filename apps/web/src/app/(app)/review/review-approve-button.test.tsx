/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReviewApproveButton } from './review-approve-button';

describe('ReviewApproveButton', () => {
  it('calls onApprove when clicked and idle', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();

    render(<ReviewApproveButton busy={false} onApprove={onApprove} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('disables and shows Approving... while busy', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();

    render(<ReviewApproveButton busy onApprove={onApprove} />);

    const button = screen.getByRole('button', { name: 'Approving...' });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

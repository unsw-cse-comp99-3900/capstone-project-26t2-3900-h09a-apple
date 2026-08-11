/** @vitest-environment jsdom */
import { useState, type FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthEmailPasswordFields } from './auth-email-password-fields';

function LoginFieldsHarness({
  onSubmit,
  submitting = false,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthEmailPasswordFields
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      passwordAutoComplete="current-password"
      onSubmit={onSubmit}
      error={null}
      submitting={submitting}
      submitLabel="Sign in"
      submittingLabel="Signing in..."
    />
  );
}

describe('AuthEmailPasswordFields', () => {
  it('does not call onSubmit when required fields are empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    render(<LoginFieldsHarness onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the submit button while submitting', () => {
    render(<LoginFieldsHarness onSubmit={vi.fn()} submitting />);

    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  });
});

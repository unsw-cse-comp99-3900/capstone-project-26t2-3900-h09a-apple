/** @vitest-environment jsdom */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccessDenied } from './access-denied';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('AccessDenied', () => {
  it('shows the signed-in role and a back link', () => {
    render(<AccessDenied role="EMPLOYEE" backHref="/dashboard" />);

    expect(
      screen.getByRole('heading', { name: 'Your role does not have access to this' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Signed in as EMPLOYEE/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});

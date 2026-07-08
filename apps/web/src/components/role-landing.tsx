'use client';

import type { ReactNode } from 'react';
import type { UserRole } from '@h09a/types';

import { useCurrentUser } from '@/contexts/auth-context';

type RoleLandingProps = {
  title: string;
  role: UserRole;
  children?: ReactNode;
};

export function RoleLanding({ title, role, children }: RoleLandingProps) {
  const { user, loading, logout } = useCurrentUser();

  if (loading) {
    return <main><p>Loading session...</p></main>;
  }

  return (
    <main>
      <h1>{title}</h1>
      <p>Placeholder landing page for {role} users.</p>
      {user ? (
        <>
          <p>
            Signed in as {user.email} ({user.role})
          </p>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
          {children}
        </>
      ) : null}
    </main>
  );
}

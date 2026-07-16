'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { AuthBrandPanel } from '@/components/auth-brand-panel';
import { AuthEmailPasswordFields } from '@/components/auth/auth-email-password-fields';
import { AuthFormCard } from '@/components/auth/auth-form-card';
import { AuthFormPanel } from '@/components/auth/auth-form-panel';
import { redirectPathForRole, useCurrentUser } from '@/contexts/auth-context';
import { broadcastExtensionHandoff } from '@/lib/extension-handoff';

import styles from './auth.module.css';

export function LoginForm() {
  const router = useRouter();
  const { user, loading, refreshSession } = useCurrentUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'failed') {
      setError('Google sign-in failed. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace(redirectPathForRole(user.role));
    }
  }, [loading, user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        setError('Invalid credentials');
        return;
      }

      const nextUser = await refreshSession();
      if (nextUser) {
        await broadcastExtensionHandoff();
        router.replace(redirectPathForRole(nextUser.role));
      }
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AuthBrandPanel />
      <AuthFormPanel>
        {loading ? (
          <p className={styles.status}>Checking session...</p>
        ) : (
          <AuthFormCard
            title="Sign in to your workspace"
            lead="Continue capturing workflows and turning them into SOP drafts."
            footer={
              <p className={styles.footer}>
                No account yet? <Link href="/register">Create one</Link>
              </p>
            }
          >
            <AuthEmailPasswordFields
              email={email}
              password={password}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              passwordAutoComplete="current-password"
              onSubmit={handleSubmit}
              error={error}
              submitting={submitting}
              submitLabel="Sign in"
              submittingLabel="Signing in..."
            />

            <div className={styles.oauthDivider}>
              <span>or</span>
            </div>

            <a className={styles.googleButton} href="/api/auth/google/start">
              <span className={styles.googleMark} aria-hidden="true">
                G
              </span>
              Sign in with Google
            </a>
          </AuthFormCard>
        )}
      </AuthFormPanel>
    </main>
  );
}

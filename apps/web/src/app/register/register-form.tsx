'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { AuthBrandPanel } from '@/components/auth-brand-panel';
import { AuthEmailPasswordFields } from '@/components/auth/auth-email-password-fields';
import { AuthFormCard } from '@/components/auth/auth-form-card';
import { AuthFormPanel } from '@/components/auth/auth-form-panel';
import { redirectPathForRole, useCurrentUser } from '@/contexts/auth-context';
import { formatApiDetail } from '@/lib/auth/errors';
import { broadcastExtensionHandoff } from '@/lib/extension-handoff';

import styles from '../login/auth.module.css';

export function RegisterForm() {
  const router = useRouter();
  const { user, loading, refreshSession } = useCurrentUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        setError(formatApiDetail(body?.detail, 'Registration failed'));
        return;
      }

      const nextUser = await refreshSession();
      if (nextUser) {
        await broadcastExtensionHandoff();
        router.replace(redirectPathForRole(nextUser.role));
      }
    } catch {
      setError('Unable to register. Please try again.');
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
            title="Create your workspace"
            lead="Start capturing workflows and turning them into SOPs."
            notice="Role and tenant are assigned by your administrator."
            footer={
              <p className={styles.footer}>
                Already have an account? <Link href="/login">Sign in</Link>
              </p>
            }
            termsNotice={
              <p className={styles.termsNotice}>
                By creating an account, you agree to our <Link href="/privacy">Privacy</Link> and{' '}
                <Link href="/privacy">Terms</Link>.
              </p>
            }
          >
            <AuthEmailPasswordFields
              email={email}
              password={password}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              passwordAutoComplete="new-password"
              onSubmit={handleSubmit}
              error={error}
              submitting={submitting}
              submitLabel="Create account"
              submittingLabel="Creating account..."
            />
          </AuthFormCard>
        )}
      </AuthFormPanel>
    </main>
  );
}

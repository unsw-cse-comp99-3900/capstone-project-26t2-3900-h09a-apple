'use client';

/**
 * Form that submits a new password with a reset token.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

import { AuthBrandPanel } from '@/components/auth-brand-panel';
import { AuthLockIcon } from '@/components/auth/auth-icons';
import { AuthFormCard } from '@/components/auth/auth-form-card';
import { AuthFormPanel } from '@/components/auth/auth-form-panel';
import { formatApiDetail } from '@/lib/auth/errors';

import styles from '../login/auth.module.css';

function ResetPasswordFormInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError('Reset link is missing or invalid.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        setError(formatApiDetail(body?.detail, 'Unable to reset password'));
        return;
      }

      setDone(true);
    } catch {
      setError('Unable to reset password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AuthBrandPanel />
      <AuthFormPanel>
        <AuthFormCard
          title="Set a new password"
          lead="Create a new password for your WorkTrace account"
          footer={
            <p className={styles.footer}>
              Ready to continue? <Link href="/login">Sign in</Link>
            </p>
          }
        >
          {done ? (
            <p className={styles.roleNotice}>
              Password updated. You can sign in with your new password.
            </p>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.field}>
                <span>New password</span>
                <span className={styles.inputWrap} data-filled={password ? true : undefined}>
                  <AuthLockIcon className={styles.inputIcon} aria-hidden="true" />
                  <input
                    className={styles.inputWithIcon}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </span>
              </label>

              {error ? <p className={styles.error}>{error}</p> : null}

              <button className={styles.button} type="submit" disabled={submitting || !token}>
                {submitting ? 'Updating...' : 'Update password'}
              </button>
            </form>
          )}
        </AuthFormCard>
      </AuthFormPanel>
    </main>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense
      fallback={
        <main className={styles.shell}>
          <AuthBrandPanel />
          <AuthFormPanel>
            <p className={styles.status}>Loading...</p>
          </AuthFormPanel>
        </main>
      }
    >
      <ResetPasswordFormInner />
    </Suspense>
  );
}

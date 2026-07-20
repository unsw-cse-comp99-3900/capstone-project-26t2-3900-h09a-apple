'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { AuthBrandPanel } from '@/components/auth-brand-panel';
import { AuthEnvelopeIcon } from '@/components/auth/auth-icons';
import { AuthFormCard } from '@/components/auth/auth-form-card';
import { AuthFormPanel } from '@/components/auth/auth-form-panel';
import { formatApiDetail } from '@/lib/auth/errors';

import styles from '../login/auth.module.css';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        setError(formatApiDetail(body?.detail, 'Unable to start password reset'));
        return;
      }

      setDone(true);
    } catch {
      setError('Unable to start password reset. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AuthBrandPanel />
      <AuthFormPanel>
        <AuthFormCard
          title="Reset your password"
          lead="Enter your email and we will send a reset link if an account exists. Google sign-in users can use this to set a password."
          footer={
            <p className={styles.footer}>
              Remembered it? <Link href="/login">Sign in</Link>
            </p>
          }
        >
          {done ? (
            <p className={styles.roleNotice}>
              If an account exists for that email, a reset link has been sent.
            </p>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.field}>
                <span>Email</span>
                <span className={styles.inputWrap} data-filled={email ? true : undefined}>
                  <AuthEnvelopeIcon className={styles.inputIcon} aria-hidden="true" />
                  <input
                    className={styles.inputWithIcon}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </span>
              </label>

              {error ? <p className={styles.error}>{error}</p> : null}

              <button className={styles.button} type="submit" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </AuthFormCard>
      </AuthFormPanel>
    </main>
  );
}

/**
 * Shared email and password fields for login/register forms.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';

import { AuthEnvelopeIcon, AuthLockIcon } from '@/components/auth/auth-icons';

import styles from '@/app/login/auth.module.css';

type AuthEmailPasswordFieldsProps = {
  email: string;
  password: string;
  onEmailChange: Dispatch<SetStateAction<string>>;
  onPasswordChange: Dispatch<SetStateAction<string>>;
  passwordAutoComplete: 'current-password' | 'new-password';
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string | null;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
};

export function AuthEmailPasswordFields({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  passwordAutoComplete,
  onSubmit,
  error,
  submitting,
  submitLabel,
  submittingLabel,
}: AuthEmailPasswordFieldsProps) {
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.field}>
        <span>Email</span>
        <span className={styles.inputWrap} data-filled={email ? true : undefined}>
          <AuthEnvelopeIcon className={styles.inputIcon} aria-hidden="true" />
          <input
            className={styles.inputWithIcon}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            required
          />
        </span>
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <span className={styles.inputWrap} data-filled={password ? true : undefined}>
          <AuthLockIcon className={styles.inputIcon} aria-hidden="true" />
          <input
            className={styles.inputWithIcon}
            type="password"
            autoComplete={passwordAutoComplete}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            required
          />
        </span>
      </label>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}

import type { ReactNode } from 'react';

import styles from '@/app/login/auth.module.css';

import { AuthFormFooter } from './auth-form-footer';

type AuthFormPanelProps = {
  children: ReactNode;
};

export function AuthFormPanel({ children }: AuthFormPanelProps) {
  return (
    <section className={styles.formPanel}>
      <div className={styles.formPanelInner}>
        <div className={styles.formCardSurface}>{children}</div>
        <AuthFormFooter />
      </div>
    </section>
  );
}

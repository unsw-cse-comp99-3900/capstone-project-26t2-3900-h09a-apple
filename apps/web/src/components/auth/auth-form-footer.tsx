/**
 * Footer links under auth forms (privacy, alternate action).
 */

import Link from 'next/link';

import styles from '@/app/login/auth.module.css';

export function AuthFormFooter() {
  return (
    <footer className={styles.formMetaFooter}>
      <span>&copy; 2026 WorkTrace AI</span>
      <span className={styles.formMetaDivider} aria-hidden="true">
        &middot;
      </span>
      <a href="/privacy">Privacy</a>
      <span className={styles.formMetaDivider} aria-hidden="true">
        &middot;
      </span>
      <a href="/privacy">Terms</a>
      <span className={styles.formMetaDivider} aria-hidden="true">
        &middot;
      </span>
      <Link href="/sop/status">Status</Link>
    </footer>
  );
}

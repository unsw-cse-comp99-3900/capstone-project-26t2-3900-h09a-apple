/**
 * Top navigation for public marketing pages.
 */

import Link from 'next/link';

import styles from '@/app/marketing.module.css';
import { AuthLogoIcon } from '@/components/auth/auth-icons';

export function MarketingHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="WorkTrace AI home">
        <span className={styles.brandMark} aria-hidden="true">
          <AuthLogoIcon className={styles.brandIcon} />
        </span>
        <span>WorkTrace AI</span>
      </Link>

      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.navLink} href="/pricing">
          Pricing
        </Link>
        <Link className={styles.navLink} href="/login">
          Sign in
        </Link>
        <Link className={styles.navCta} href="/register">
          Get started
        </Link>
      </nav>
    </header>
  );
}

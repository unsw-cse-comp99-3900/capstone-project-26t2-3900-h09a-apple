import Link from 'next/link';
import styles from './home.module.css';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'WorkTrace AI';

export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <p className={styles.brand}>{APP_NAME}</p>
        <h1>Capture work. Coach friction. Ship SOPs.</h1>
        <p className={styles.lead}>
          WorkTrace turns real workflows into guided SOPs and manager-ready variance insights.
        </p>
        <div className={styles.actions}>
          <Link href="/login" className={styles.primary}>
            Get started
          </Link>
          <Link href="/pricing" className={styles.secondary}>
            Pricing
          </Link>
        </div>
      </div>
    </main>
  );
}

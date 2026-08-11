/**
 * Marketing landing page for WorkTrace.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingHeader } from '@/components/marketing-header';

import styles from './marketing.module.css';

export const metadata: Metadata = {
  title: 'WorkTrace AI | Turn real workflows into living SOPs',
  description:
    'Capture browser tasks, review each step, and generate editable SOP drafts for onboarding and process improvement.',
};

const VALUE_PROPS = [
  {
    title: 'Record real work',
    description: 'Capture clicks, inputs, page changes, and screenshots.',
  },
  {
    title: 'Review before generation',
    description: 'Confirm the timeline before creating an SOP.',
  },
  {
    title: 'Generate editable SOPs',
    description: 'Turn sessions into structured instructions your team can refine.',
  },
] as const;

export default function HomePage() {
  return (
    <main className={styles.page}>
      <MarketingHeader />

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>AI-assisted SOP drafting</p>
          <h1>Capture work. Coach friction. Ship SOPs.</h1>
          <p className={styles.heroLead}>
            Capture browser tasks, review each step, and generate editable SOP drafts for onboarding
            and process improvement.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/register">
              Get started
            </Link>
            <Link className={styles.secondaryButton} href="/pricing">
              Pricing
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.contentSection} aria-labelledby="value-heading">
        <div className={styles.sectionHeading}>
          <h2 id="value-heading">Turn real workflows into living SOPs.</h2>
          <p>
            Capture browser tasks, review each step, and generate editable SOP drafts for onboarding
            and process improvement.
          </p>
        </div>

        <div className={styles.valueGrid}>
          {VALUE_PROPS.map((item, index) => (
            <article className={styles.valueCard} key={item.title}>
              <span className={styles.valueNumber} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.pricingCallout} aria-labelledby="pricing-heading">
        <div>
          <h2 id="pricing-heading">Start free in the browser.</h2>
          <p>
            Upgrade when you need desktop capture, more published SOPs, or a shared team library.
          </p>
        </div>
        <Link className={styles.outlineButton} href="/pricing">
          View pricing
        </Link>
      </section>

      <footer className={styles.footer}>
        <p>WorkTrace AI</p>
        <div className={styles.footerLinks}>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </main>
  );
}

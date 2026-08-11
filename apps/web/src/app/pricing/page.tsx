/**
 * Route entry for the pricing experiment page.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '@/app/marketing.module.css';
import { MarketingHeader } from '@/components/marketing-header';

import { PricingPlans } from './pricing-plans';

export const metadata: Metadata = {
  title: 'Pricing | WorkTrace AI',
  description: 'Compare Free, Solo, Team, and Business plans for WorkTrace AI.',
};

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <MarketingHeader />

      <section className={styles.pricingHero}>
        <p className={styles.eyebrow}>Early access pricing</p>
        <h1>Capture real work. Ship SOPs people actually follow.</h1>
        <p>
          Start free in the browser, then upgrade when you need desktop capture, more published
          SOPs, or a shared team library.
        </p>
      </section>

      <section className={styles.pricingSection} aria-label="Pricing plans">
        <PricingPlans />
      </section>

      <footer className={styles.footer}>
        <p>WorkTrace AI</p>
        <div className={styles.footerLinks}>
          <Link href="/">Back home</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import styles from './pricing.module.css';

export default function PricingPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }
    setSubmitted(true);
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.brand}>WorkTrace</p>
        <p className={styles.eyebrow}>Pricing</p>
        <h1>Plans are coming soon</h1>
        <p className={styles.lead}>
          We are finalising our plans. Leave your email and we will be in touch. We are not charging
          a card today.
        </p>

        {submitted ? (
          <div className={styles.thanks} role="status">
            <p className={styles.thanksTitle}>Thanks, interest recorded.</p>
            <p>Billing is not open yet. When plans launch, we will follow up at {email.trim()}.</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={onSubmit}>
            <label htmlFor="pricing-email">Work email</label>
            <input
              id="pricing-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" className={styles.cta}>
              Notify me
            </button>
          </form>
        )}

        <section className={styles.tiers} aria-label="Plan tiers coming soon">
          <p className={styles.tiersNote}>
            Tier details will appear here when plans are published.
          </p>
        </section>

        <p className={styles.footer}>
          <Link href="/">Back home</Link>
          {' · '}
          <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

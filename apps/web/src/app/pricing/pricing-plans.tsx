'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import styles from '@/app/marketing.module.css';

type Interest = {
  tier: 'Solo' | 'Team' | 'Business';
  kind: 'subscribe' | 'contact';
};

const PLANS = [
  {
    name: 'Free',
    price: '--',
    suffix: '',
    meta: '',
    blurb: 'Try the core loop alone in the browser.',
    features: [
      '1 seat',
      'Browser extension capture only',
      'Up to 3 published SOPs',
      'No shared library or review queue',
    ],
    cta: 'Start with Free',
    action: 'free',
  },
  {
    name: 'Solo',
    price: '--',
    suffix: '',
    meta: '',
    blurb: 'One operator with desktop + browser capture.',
    features: ['Desktop + browser capture', 'Personal SOP library', 'Guided walkthrough playback'],
    cta: 'Subscribe to Solo',
    action: 'subscribe',
  },
  {
    name: 'Team',
    price: '--',
    suffix: '',
    meta: '',
    blurb: 'Shared library and review before publish.',
    features: ['Everything in Solo', 'Shared library + roles', 'Review before publish'],
    cta: 'Subscribe to Team',
    action: 'subscribe',
    badge: 'Most teams start here',
    featured: true,
  },
  {
    name: 'Business',
    price: '--',
    suffix: '',
    meta: '',
    blurb: 'Multi-team orgs that need priority help.',
    features: ['Everything in Team', 'Org-wide library', 'Priority onboarding help'],
    cta: 'Request early access',
    action: 'contact',
  },
] as const;

export function PricingPlans() {
  const [interest, setInterest] = useState<Interest | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (interest) {
      statusRef.current?.focus();
    }
  }, [interest]);

  function showComingSoon(tier: Interest['tier'], kind: Interest['kind']) {
    setInterest({ tier, kind });
  }

  return (
    <>
      <div className={styles.planGrid}>
        {PLANS.map((plan) => (
          <article
            className={`${styles.planCard} ${
              'featured' in plan && plan.featured ? styles.featuredPlan : ''
            }`}
            key={plan.name}
          >
            {'badge' in plan ? <p className={styles.planBadge}>{plan.badge}</p> : null}
            <p className={styles.planName}>{plan.name}</p>
            <p
              className={`${styles.planPrice} ${
                plan.name === 'Business' ? styles.businessPrice : ''
              }`}
            >
              <strong>{plan.price}</strong>
              {plan.suffix}
            </p>
            <p className={styles.planMeta}>{plan.meta || '\u00a0'}</p>
            <p className={styles.planBlurb}>{plan.blurb}</p>
            <ul className={styles.featureList}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>

            {plan.action === 'free' ? (
              <Link className={styles.planButton} href="/register">
                {plan.cta}
              </Link>
            ) : (
              <button
                className={styles.planButton}
                type="button"
                onClick={() =>
                  showComingSoon(plan.name as Interest['tier'], plan.action as Interest['kind'])
                }
              >
                {plan.cta}
              </button>
            )}
          </article>
        ))}
      </div>

      {interest ? (
        <div
          ref={statusRef}
          className={styles.comingSoon}
          role="status"
          tabIndex={-1}
          aria-live="polite"
        >
          <h2>
            {interest.kind === 'subscribe'
              ? `${interest.tier} subscriptions are coming soon.`
              : 'Business early access is coming soon.'}
          </h2>
          <p>
            {interest.kind === 'subscribe'
              ? `You will not be charged today. Billing for the ${interest.tier} plan is not open yet.`
              : 'Contact requests are not open yet, and no payment or contact details are collected on this page.'}
          </p>
        </div>
      ) : null}

      <p className={styles.pricingNote}>
        No payment is processed on this page. Solo and Team subscriptions are not open yet.
      </p>
    </>
  );
}

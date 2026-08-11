/**
 * Privacy policy page linked from consent and auth footers.
 */

import Link from 'next/link';

import { CONSENT_COPY, CONSENT_TERMS_VERSION } from '@/lib/consent/constants';

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '2rem 1rem',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <h1>Privacy and data capture</h1>
      <p style={{ color: '#5f6b8f', lineHeight: 1.65 }}>
        Product copy for WorkTrace AI. Final legal text will be provided separately.
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>{CONSENT_COPY.title}</h2>
        <p style={{ color: '#5f6b8f' }}>Terms version: {CONSENT_TERMS_VERSION}</p>
        <p style={{ lineHeight: 1.65 }}>{CONSENT_COPY.intro}</p>
        <ul style={{ lineHeight: 1.65, color: '#334065' }}>
          {CONSENT_COPY.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/login" style={{ color: '#5b63d9' }}>
          Back to sign in
        </Link>
      </p>
    </main>
  );
}

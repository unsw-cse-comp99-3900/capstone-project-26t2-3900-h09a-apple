import Link from 'next/link';

import styles from './sidebar.module.css';

type AccessDeniedProps = {
  role: string;
  backHref: string;
};

export function AccessDenied({ role, backHref }: AccessDeniedProps) {
  return (
    <section className={styles.denied}>
      <h1>Your role does not have access to this</h1>
      <p>
        Signed in as {role}. This route is outside your workspace permissions. Return to your
        dashboard to continue.
      </p>
      <Link href={backHref}>Back to dashboard</Link>
    </section>
  );
}

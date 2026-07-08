import Link from 'next/link';
import type { SopLibraryItem } from '@h09a/types';
import styles from './library.module.css';

type Props = {
  sop: SopLibraryItem;
};

const MAX_DOTS = 10;

// Display a published SOP summary card styled as a catalog index card.
export default function SopCard({ sop }: Props) {
  const publishedDate = sop.published_at
    ? new Date(sop.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const dotCount = Math.min(sop.step_count, MAX_DOTS);
  const overflow = sop.step_count - dotCount;

  return (
    <Link href={`/sop/${sop.id}`} className={styles.card}>
      <span className={styles.cardTab} aria-hidden="true">
        {sop.workflow_category ?? 'Procedure'}
      </span>

      <h2 className={styles.cardTitle}>{sop.title}</h2>

      <div className={styles.cardDivider} aria-hidden="true" />

      <div className={styles.cardFooter}>
        <div
          className={styles.stepDots}
          role="img"
          aria-label={`${sop.step_count} ${sop.step_count === 1 ? 'step' : 'steps'}`}
        >
          {Array.from({ length: dotCount }).map((_, i) => (
            <span key={i} className={styles.dot} />
          ))}
          {overflow > 0 && <span className={styles.dotOverflow}>+{overflow}</span>}
        </div>

        {publishedDate && (
          <span className={styles.stamp}>
            Verified
            <span className={styles.stampDate}>{publishedDate}</span>
          </span>
        )}
      </div>
    </Link>
  );
}

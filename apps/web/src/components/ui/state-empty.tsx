/**
 * Empty-state block with optional call-to-action.
 */

import Link from 'next/link';

import styles from './state-blocks.module.css';

type StateEmptyProps = {
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
};

export function StateEmpty({ title, body, actionLabel, actionHref, onAction }: StateEmptyProps) {
  return (
    <div className={styles.block}>
      <div className={styles.icon} aria-hidden>
        ○
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.body}>{body}</p>
      {actionHref && actionLabel ? (
        <Link className={styles.action} href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
      {onAction && actionLabel && !actionHref ? (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

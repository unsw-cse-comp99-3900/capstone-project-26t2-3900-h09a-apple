/**
 * Inline error state with retry-friendly copy.
 */

import styles from './state-blocks.module.css';

type StateErrorProps = {
  message: string;
  code: string;
  onRetry?: () => void;
};

export function StateError({ message, code, onRetry }: StateErrorProps) {
  return (
    <div className={`${styles.block} ${styles.error}`} role="alert">
      <div className={styles.icon} aria-hidden>
        !
      </div>
      <h3 className={styles.title}>Something went wrong</h3>
      <p className={styles.body}>{message}</p>
      <span className={styles.codeChip}>{code}</span>
      {onRetry ? (
        <button type="button" className={styles.action} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Approve control for a draft / needs_review SOP in the reviewer queue.
 */

import styles from './review.module.css';

type ReviewApproveButtonProps = {
  busy: boolean;
  onApprove: () => void;
};

export function ReviewApproveButton({ busy, onApprove }: ReviewApproveButtonProps) {
  return (
    <button type="button" className={styles.primaryButton} disabled={busy} onClick={onApprove}>
      {busy ? 'Approving...' : 'Approve'}
    </button>
  );
}

import styles from './library.module.css';

type Props = {
  title?: string;
  description?: string;
};

// Displayed when there are no published SOPs.
export default function EmptyState({
  title = 'No procedures filed yet.',
  description = 'Record your first workflow to start the shelf.',
}: Props) {
  return (
    <div className={styles.emptyState}>
      <svg className={styles.emptyIcon} viewBox="0 0 64 48" fill="none" aria-hidden="true">
        <rect x="2" y="10" width="60" height="34" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M2 20h60" stroke="currentColor" strokeWidth="2" />
        <rect x="26" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="2" />
      </svg>

      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyText}>{description}</p>
    </div>
  );
}

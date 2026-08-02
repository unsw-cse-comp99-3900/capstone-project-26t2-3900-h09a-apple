import styles from './stat-card.module.css';

type StatCardProps = {
  label: string;
  value: string;
  deltaLabel?: string;
  deltaTone?: 'up' | 'down' | 'flat';
  accent?: string;
};

export function StatCard({
  label,
  value,
  deltaLabel = 'vs prior period',
  deltaTone = 'flat',
  accent = '#0ea5e9',
}: StatCardProps) {
  return (
    <article className={styles.card} style={{ borderLeftColor: accent }}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{value}</p>
      <p className={`${styles.delta} ${styles[deltaTone]}`}>{deltaLabel}</p>
    </article>
  );
}

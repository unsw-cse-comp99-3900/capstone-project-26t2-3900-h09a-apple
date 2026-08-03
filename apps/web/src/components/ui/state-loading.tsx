import styles from './state-blocks.module.css';

type StateLoadingProps = {
  rows?: number;
  label?: string;
};

export function StateLoading({ rows = 3, label = 'Loading' }: StateLoadingProps) {
  return (
    <div className={styles.block} aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skeleton} />
      ))}
    </div>
  );
}

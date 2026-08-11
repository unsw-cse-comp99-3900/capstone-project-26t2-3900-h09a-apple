/**
 * Controlled search field for the SOP Library drawer.
 */

import styles from './library.module.css';

type LibrarySearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
};

export function LibrarySearchBox({ value, onChange }: LibrarySearchBoxProps) {
  return (
    <div className={styles.searchBlock}>
      <label htmlFor="search" className={styles.drawerLabel}>
        Find a procedure
      </label>
      <input
        id="search"
        type="search"
        placeholder="Search by title…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={styles.input}
      />
    </div>
  );
}

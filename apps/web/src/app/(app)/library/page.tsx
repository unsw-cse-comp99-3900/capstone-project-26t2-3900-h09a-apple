import LibraryClient from './LibraryClient';
import styles from './library.module.css';

export default function LibraryPage() {
  return (
    <main className={styles.pageShell}>
      <LibraryClient />
    </main>
  );
}

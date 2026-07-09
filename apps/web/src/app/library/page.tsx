import LibraryClient from './LibraryClient';
import styles from './library.module.css';

type Props = {
  searchParams: Promise<{ search?: string }>;
};

export default async function LibraryPage() {
  return (
    <main className={styles.pageShell}>
      <LibraryClient />
    </main>
  );
}

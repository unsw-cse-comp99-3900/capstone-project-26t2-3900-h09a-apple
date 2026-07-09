import { getPublishedSops } from '@/lib/api';
import LibraryClient from './LibraryClient';
import styles from './library.module.css';

type Props = {
  searchParams: Promise<{ search?: string }>;
};

export default async function LibraryPage({ searchParams }: Props) {
  const data = await getPublishedSops();
  const { search = '' } = await searchParams;

  return (
    <main className={styles.pageShell}>
      <LibraryClient sops={data.sops} initialSearch={search} />
    </main>
  );
}

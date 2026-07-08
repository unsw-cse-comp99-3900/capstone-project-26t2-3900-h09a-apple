import type { SopListResponse } from '@h09a/types';
// import { getPublishedSops } from '@/lib/api';
import LibraryClient from './LibraryClient';
import styles from './library.module.css';

type Props = {
  searchParams: Promise<{ search?: string }>;
};

const mockData: SopListResponse = {
  sops: [
    {
      id: '1',
      title: 'Reset Jira Password',
      workflow_category: null,
      step_count: 5,
      published_at: '2026-07-06T10:00:00Z',
    },
    {
      id: '2',
      title: 'Create New Employee Account',
      workflow_category: null,
      step_count: 8,
      published_at: '2026-07-05T15:30:00Z',
    },
    {
      id: '3',
      title: 'Submit Weekly Timesheet',
      workflow_category: null,
      step_count: 4,
      published_at: '2026-07-03T09:15:00Z',
    },
    {
      id: '4',
      title: 'Submit Weekly Timesheet',
      workflow_category: null,
      step_count: 4,
      published_at: '2026-07-03T09:16:00Z',
    },
  ],
};

export default async function LibraryPage({ searchParams }: Props) {
  // TODO(H09AAPPLE-44):
  // Replace mock data with getPublishedSops() once frontend authentication is available.
  // const data = await getPublishedSops();

  const data = mockData;
  const { search = '' } = await searchParams;

  return (
    <main className={styles.pageShell}>
      <LibraryClient sops={data.sops} initialSearch={search} />
    </main>
  );
}
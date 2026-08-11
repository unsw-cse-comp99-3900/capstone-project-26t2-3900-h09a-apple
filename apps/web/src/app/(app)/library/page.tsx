/**
 * Route entry for the SOP library browser.
 */

import { Suspense } from 'react';

import { StateLoading } from '@/components/ui/state-loading';

import LibraryClient from './LibraryClient';
import styles from './library.module.css';

export default function LibraryPage() {
  return (
    <main className={styles.pageShell}>
      <Suspense
        fallback={
          <div className={styles.container}>
            <StateLoading rows={4} label="Loading procedures" />
          </div>
        }
      >
        <LibraryClient />
      </Suspense>
    </main>
  );
}

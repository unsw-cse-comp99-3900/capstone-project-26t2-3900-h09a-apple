'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SopLibraryItem } from '@h09a/types';
import SopCard from './SopCard';
import EmptyState from './EmptyState';
import styles from './library.module.css';

type Props = {
  sops: SopLibraryItem[];
  initialSearch: string;
};

// Client side title search with URL sync.
export default function LibraryClient({ sops, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(initialSearch);

  useEffect(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set('search', search);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [search, pathname, router]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return sops;

    return sops.filter((sop) =>
      sop.title.toLowerCase().includes(keyword)
    );
  }, [search, sops]);

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <p className={styles.eyebrow}>Internal reference</p>
        <h1 className={styles.title}>SOP Library</h1>
        <p className={styles.subtitle}>
          Every procedure your team has recorded, ready to open and follow step by step.
        </p>
      </div>

      <div className={styles.drawer}>
        <label htmlFor="search" className={styles.drawerLabel}>
          Find a procedure
        </label>

        <input
          id="search"
          type="text"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.input}
        />

        <p className={styles.count}>
          Showing {filtered.length} of {sops.length} procedures
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className={styles.grid}>
          {filtered.map((sop) => (
            <SopCard key={sop.id} sop={sop} />
          ))}
        </div>
      )}
    </div>
  );
}
'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SopLibraryItem } from '@h09a/types';

import { getPublishedSops } from '@/lib/api';

import SopCard from './SopCard';
import EmptyState from './EmptyState';
import styles from './library.module.css';
import { useCurrentUser } from '@/contexts/auth-context';

// Client-side SOP library with authenticated data loading.
export default function LibraryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useCurrentUser();

  const [search, setSearch] = useState('');

  const [sops, setSops] = useState<SopLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getPublishedSops();
        setSops(data.sops);
      } catch {
        setError('Failed to load SOP library.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set('search', search);
    }

    const query = params.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [search, pathname, router]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return sops;
    }

    return sops.filter((sop) => sop.title.toLowerCase().includes(keyword));
  }, [search, sops]);

  if (loading) {
    return (
      <div className={styles.container}>
        <p className={styles.count}>Loading procedures...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <p className={styles.count}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Internal reference</p>

          <h1 className={styles.title}>SOP Library</h1>

          <p className={styles.subtitle}>
            Every procedure your team has recorded, ready to open and follow step by step.
          </p>
        </div>

        <div className={styles.userPanel}>
          <div>
            <p className={styles.userEmail}>{user?.email}</p>
            <p className={styles.userRole}>{user?.role}</p>
          </div>

          <button type="button" className={styles.logoutButton} onClick={() => void logout()}>
            Log out
          </button>
        </div>
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

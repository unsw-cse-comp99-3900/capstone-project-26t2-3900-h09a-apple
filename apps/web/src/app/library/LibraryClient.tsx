'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SopLibraryItem } from '@h09a/types';

import { getMyDrafts, getPublishedSops } from '@/lib/api';

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

  const [publishedSops, setPublishedSops] = useState<SopLibraryItem[]>([]);
  const [draftSops, setDraftSops] = useState<SopLibraryItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<'published' | 'drafts'>('published');

  useEffect(() => {
    async function loadPublished() {
      try {
        const data = await getPublishedSops();
        setPublishedSops(data.sops);
      } catch {
        setError('Failed to load SOP library.');
      }
    }

    async function loadDrafts() {
      try {
        const data = await getMyDrafts();
        setDraftSops(data.sops);
      } catch {
        setError('Failed to load your draft SOPs.');
      }
    }

    async function load() {
      setError(null);

      if (tab === 'published') {
        if (publishedSops.length === 0) {
          setLoading(true);
          await loadPublished();
          setLoading(false);
        }
      } else {
        if (draftSops.length === 0) {
          setLoading(true);
          await loadDrafts();
          setLoading(false);
        }
      }
    }

    void load();
  }, [tab, publishedSops.length, draftSops.length]);

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

  const sops = tab === 'published' ? publishedSops : draftSops;

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

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === 'published' ? styles.activeTab : styles.tab}
          onClick={() => setTab('published')}
        >
          Published
        </button>

        <button
          type="button"
          className={tab === 'drafts' ? styles.activeTab : styles.tab}
          onClick={() => setTab('drafts')}
        >
          My Drafts
        </button>
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
          Showing {filtered.length} of {sops.length}{' '}
          {tab === 'published' ? 'published procedures' : 'draft procedures'}
        </p>
      </div>

      {sops.length === 0 ? (
        tab === 'published' ? (
          <EmptyState />
        ) : (
          <EmptyState
            title="No draft SOPs yet."
            description="Your submitted SOPs will appear here until they are published."
          />
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No procedures match your search."
          description={
            tab === 'published'
              ? 'Try a different keyword or clear the search to see all published procedures.'
              : 'Try a different keyword or clear the search to see all of your draft SOPs.'
          }
        />
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

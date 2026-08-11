'use client';

/**
 * SOP Library browser: search, filter chips, and role-aware draft/published lists.
 *
 * Employees see published playable SOPs; authors also see their own drafts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SopLibraryItem } from '@h09a/types';

import { StateEmpty } from '@/components/ui/state-empty';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import { useCurrentUser } from '@/contexts/auth-context';
import { getMyDrafts, getMyPublishedSops, getPublishedSops } from '@/lib/api';

import SopCard from './SopCard';
import {
  applyLibraryChip,
  countLibraryChips,
  filterAndRankSops,
  type LibraryFilterChip,
} from './library-search';
import { LibrarySearchBox } from './library-search-box';
import styles from './library.module.css';

const VIEW_STORAGE_KEY = 'worktrace.library.view';
const SEARCH_DEBOUNCE_MS = 200;
const LIBRARY_ERROR_CODE = 'LIBRARY_LOAD_FAILED';

type LibraryTab = 'published' | 'drafts';
type LibraryView = 'grid' | 'list';

function readStoredView(): LibraryView {
  if (typeof window === 'undefined') {
    return 'grid';
  }

  return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
}

function formatRefreshedAt(value: Date | null): string {
  if (!value) {
    return 'Not refreshed yet';
  }

  return `Last refreshed ${value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

// Client-side SOP library with authenticated data loading.
export default function LibraryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useCurrentUser();

  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') ?? '');
  const [chip, setChip] = useState<LibraryFilterChip>('all');
  const [view, setView] = useState<LibraryView>('grid');

  const [publishedSops, setPublishedSops] = useState<SopLibraryItem[]>([]);
  const [draftSops, setDraftSops] = useState<SopLibraryItem[]>([]);
  const [minePublishedIds, setMinePublishedIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [mineFilterWarning, setMineFilterWarning] = useState<string | null>(null);

  const canDeleteAnyInTenant = user?.role === 'REVIEWER' || user?.role === 'MANAGER';

  const [tab, setTab] = useState<LibraryTab>('published');

  useEffect(() => {
    setView(readStoredView());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    const trimmed = debouncedSearch.trim();
    if (trimmed) {
      params.set('search', trimmed);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [debouncedSearch, pathname, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLaunchError(null);
    setDeleteError(null);
    setMineFilterWarning(null);

    try {
      if (tab === 'published') {
        const published = await getPublishedSops();
        setPublishedSops(published.sops);

        try {
          const minePublished = await getMyPublishedSops();
          setMinePublishedIds(new Set(minePublished.sops.map((sop) => sop.id)));
          setMineFilterWarning(null);
        } catch {
          setMinePublishedIds(new Set());
          setMineFilterWarning(
            'Could not load which published procedures are yours. The Mine filter may show 0 until you try again.',
          );
        }
      } else {
        const drafts = await getMyDrafts();
        setDraftSops(drafts.sops);
        setMineFilterWarning(null);
      }

      setLastRefreshedAt(new Date());
    } catch {
      setError(
        tab === 'published'
          ? 'Could not load the SOP library. Check your connection and try again.'
          : 'Could not load your draft SOPs. Check your connection and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const sops = tab === 'published' ? publishedSops : draftSops;

  const mineIds = useMemo(() => {
    if (tab === 'drafts') {
      return new Set(draftSops.map((sop) => sop.id));
    }
    return minePublishedIds;
  }, [tab, draftSops, minePublishedIds]);

  const chipCounts = useMemo(() => countLibraryChips(sops, mineIds), [sops, mineIds]);

  const chipFiltered = useMemo(() => applyLibraryChip(sops, chip, mineIds), [sops, chip, mineIds]);

  const filtered = useMemo(
    () => filterAndRankSops(chipFiltered, debouncedSearch),
    [chipFiltered, debouncedSearch],
  );

  function handleViewChange(next: LibraryView) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function clearSearchAndFilters() {
    setSearchInput('');
    setDebouncedSearch('');
    setChip('all');
  }

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.title}>SOP Library</h1>
          <p className={styles.subtitle}>
            Every procedure your team has recorded, ready to open and follow step by step.
          </p>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === 'published' ? styles.activeTab : styles.tab}
          onClick={() => {
            setTab('published');
            setChip('all');
          }}
        >
          Published
        </button>
        <button
          type="button"
          className={tab === 'drafts' ? styles.activeTab : styles.tab}
          onClick={() => {
            setTab('drafts');
            setChip('all');
          }}
        >
          My Drafts
        </button>
      </div>

      <div className={styles.drawer}>
        <div className={styles.controlsRow}>
          <LibrarySearchBox value={searchInput} onChange={setSearchInput} />

          <div className={styles.viewToggle} role="group" aria-label="Library view">
            <button
              type="button"
              className={view === 'grid' ? styles.viewActive : styles.viewButton}
              aria-pressed={view === 'grid'}
              onClick={() => handleViewChange('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className={view === 'list' ? styles.viewActive : styles.viewButton}
              aria-pressed={view === 'list'}
              onClick={() => handleViewChange('list')}
            >
              List
            </button>
          </div>
        </div>

        <div className={styles.chips} role="group" aria-label="Library filters">
          {(
            [
              ['all', 'All'],
              ['recent', 'Recently updated'],
              ['mine', 'Mine'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={chip === id ? styles.chipActive : styles.chip}
              aria-pressed={chip === id}
              onClick={() => setChip(id)}
            >
              {label} <span className={styles.chipCount}>{chipCounts[id]}</span>
            </button>
          ))}
        </div>

        <p className={styles.count}>
          Showing {filtered.length} of {sops.length}
          <span className={styles.countMeta}> · {formatRefreshedAt(lastRefreshedAt)}</span>
        </p>
      </div>

      {mineFilterWarning ? (
        <p className={styles.filterWarning} role="status">
          {mineFilterWarning}{' '}
          <button type="button" className={styles.inlineRetry} onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {launchError ? (
        <p className={styles.launchError} role="alert">
          {launchError}
        </p>
      ) : null}

      {deleteError ? (
        <p className={styles.launchError} role="alert">
          {deleteError}
        </p>
      ) : null}

      {loading ? (
        <div className={styles.stateSlot}>
          <StateLoading rows={4} label="Loading procedures" />
        </div>
      ) : error ? (
        <div className={styles.stateSlot}>
          <StateError message={error} code={LIBRARY_ERROR_CODE} onRetry={() => void load()} />
        </div>
      ) : sops.length === 0 ? (
        <div className={styles.stateSlot}>
          {tab === 'published' ? (
            <StateEmpty
              title="No procedures filed yet"
              body="Record your first workflow to start the library."
              actionLabel="Open dashboard"
              actionHref="/dashboard"
            />
          ) : (
            <StateEmpty
              title="No draft SOPs yet"
              body="Your submitted SOPs will appear here until they are published."
              actionLabel="Open dashboard"
              actionHref="/dashboard"
            />
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.stateSlot}>
          <StateEmpty
            title="No matching procedures"
            body={
              debouncedSearch.trim()
                ? `Nothing matched "${debouncedSearch.trim()}" with the current filter. Clear the search to see more results.`
                : 'Nothing matched the current filter. Clear filters to see all procedures in this tab.'
            }
            actionLabel="Clear search and filters"
            onAction={clearSearchAndFilters}
          />
        </div>
      ) : (
        <div className={view === 'list' ? styles.list : styles.grid}>
          {filtered.map((sop) => (
            <SopCard
              key={sop.id}
              sop={sop}
              view={view}
              canDelete={canDeleteAnyInTenant || mineIds.has(sop.id)}
              onLaunchError={(message) => setLaunchError(message)}
              onLaunchSuccess={() => setLaunchError(null)}
              onDeleteError={(message) => setDeleteError(message)}
              onDeleted={() => {
                setDeleteError(null);
                void load();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

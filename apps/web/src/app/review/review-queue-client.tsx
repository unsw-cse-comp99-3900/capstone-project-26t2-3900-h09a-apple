'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { SopLibraryItem } from '@h09a/types';

import { useCurrentUser } from '@/contexts/auth-context';
import { ApiError, approveSop, getSopsByStatus, publishSop } from '@/lib/api';

import styles from './review.module.css';
import { VoiceFeedbackPanel } from './voice-feedback-panel';

type QueueItem = SopLibraryItem & { busy?: boolean };
type ReviewTab = 'sops' | 'feedback';

function statusLabel(status: string): string {
  if (status === 'draft') return 'Pending approval';
  if (status === 'needs_review') return 'Needs review';
  if (status === 'approved') return 'Approved';
  return status;
}

export function ReviewQueueClient() {
  const { user, loading, logout } = useCurrentUser();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'feedback' ? 'feedback' : 'sops';
  const feedbackId = searchParams.get('feedbackId');
  const [tab, setTab] = useState<ReviewTab>(initialTab);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setError(null);

    try {
      const [drafts, needsReview, approved] = await Promise.all([
        getSopsByStatus('draft'),
        getSopsByStatus('needs_review'),
        getSopsByStatus('approved'),
      ]);

      const merged = [...drafts.sops, ...needsReview.sops, ...approved.sops].sort((left, right) =>
        left.title.localeCompare(right.title),
      );

      setItems(merged);
    } catch (loadError) {
      setError(
        loadError instanceof ApiError ? loadError.message : 'Failed to load the review queue.',
      );
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!loading && user?.role === 'REVIEWER' && tab === 'sops') {
      void loadQueue();
    }
  }, [loading, user?.role, loadQueue, tab]);

  async function handleApprove(sopId: string) {
    setItems((current) =>
      current.map((item) => (item.id === sopId ? { ...item, busy: true } : item)),
    );
    setError(null);

    try {
      await approveSop(sopId);
      await loadQueue();
    } catch (actionError) {
      setError(actionError instanceof ApiError ? actionError.message : 'Failed to approve SOP.');
      setItems((current) =>
        current.map((item) => (item.id === sopId ? { ...item, busy: false } : item)),
      );
    }
  }

  async function handlePublish(sopId: string) {
    setItems((current) =>
      current.map((item) => (item.id === sopId ? { ...item, busy: true } : item)),
    );
    setError(null);

    try {
      await publishSop(sopId);
      await loadQueue();
    } catch (actionError) {
      setError(actionError instanceof ApiError ? actionError.message : 'Failed to publish SOP.');
      setItems((current) =>
        current.map((item) => (item.id === sopId ? { ...item, busy: false } : item)),
      );
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Loading session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Redirecting to sign in...</p>
      </main>
    );
  }

  if (user.role !== 'REVIEWER') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Review queue</h1>
        <p className={styles.muted}>
          This page is for REVIEWER accounts. Signed in as {user.email} ({user.role}).
        </p>
        <div className={styles.headerActions}>
          <Link href="/library" className={styles.linkButton}>
            Open library
          </Link>
          <button type="button" className={styles.secondaryButton} onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Reviewer workspace</p>
          <h1 className={styles.title}>Review queue</h1>
          <p className={styles.lead}>
            Approve draft SOPs and review employee voice feedback with transcript and severity.
          </p>
        </div>
        <div className={styles.headerActions}>
          <p className={styles.userMeta}>
            {user.email} ({user.role})
          </p>
          <Link href="/library" className={styles.linkButton}>
            Library
          </Link>
          <button type="button" className={styles.secondaryButton} onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'sops' ? styles.tabActive : ''}`}
          onClick={() => setTab('sops')}
        >
          SOP queue
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'feedback' ? styles.tabActive : ''}`}
          onClick={() => setTab('feedback')}
        >
          Voice feedback
        </button>
      </div>

      {tab === 'feedback' ? (
        <VoiceFeedbackPanel initialFeedbackId={feedbackId} />
      ) : (
        <>
          {error ? <p className={styles.error}>{error}</p> : null}

          {loadingQueue ? (
            <p className={styles.muted}>Loading review queue...</p>
          ) : items.length === 0 ? (
            <section className={styles.empty}>
              <h2>No SOPs waiting</h2>
              <p>Draft and approved SOPs in this workspace will show up here.</p>
            </section>
          ) : (
            <ul className={styles.list}>
              {items.map((sop) => (
                <li key={sop.id} className={styles.card}>
                  <div className={styles.cardBody}>
                    <div className={styles.cardMeta}>
                      <span className={styles.status}>{statusLabel(sop.status)}</span>
                      <span className={styles.steps}>{sop.step_count} steps</span>
                    </div>
                    <h2 className={styles.cardTitle}>{sop.title}</h2>
                    <p className={styles.cardId}>{sop.id}</p>
                  </div>
                  <div className={styles.cardActions}>
                    <Link href={`/sop/${sop.id}`} className={styles.linkButton}>
                      Open
                    </Link>
                    {sop.status === 'draft' || sop.status === 'needs_review' ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={sop.busy}
                        onClick={() => void handleApprove(sop.id)}
                      >
                        {sop.busy ? 'Approving...' : 'Approve'}
                      </button>
                    ) : null}
                    {sop.status === 'approved' ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={sop.busy}
                        onClick={() => void handlePublish(sop.id)}
                      >
                        {sop.busy ? 'Publishing...' : 'Publish'}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { SopLibraryItem } from '@h09a/types';

import { StateEmpty } from '@/components/ui/state-empty';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import { useCurrentUser } from '@/contexts/auth-context';
import { ApiError, approveSop, getSopsByStatus, publishSop } from '@/lib/api';

import styles from './review.module.css';
import { SopStepEditor } from './sop-step-editor';
import { VoiceFeedbackPanel } from './voice-feedback-panel';

type QueueItem = SopLibraryItem & { busy?: boolean };
type ReviewTab = 'sops' | 'feedback';

function statusLabel(status: string): string {
  if (status === 'draft') return 'Pending approval';
  if (status === 'needs_review') return 'Needs review';
  if (status === 'approved') return 'Approved';
  return status;
}

function canAccessReview(role: string | undefined): boolean {
  return role === 'REVIEWER' || role === 'MANAGER';
}

type ReviewQueueClientProps = {
  /** Hide page chrome when rendered inside the dashboard primary column. */
  embedded?: boolean;
};

export function ReviewQueueClient({ embedded = false }: ReviewQueueClientProps) {
  const { user, loading } = useCurrentUser();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') === 'feedback' ? 'feedback' : 'sops';
  const feedbackId = searchParams.get('feedbackId');
  const [tab, setTab] = useState<ReviewTab>(requestedTab);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [editingSopId, setEditingSopId] = useState<string | null>(null);

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
    setTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (!loading && canAccessReview(user?.role) && tab === 'sops') {
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

  const shellClass = embedded ? styles.embedded : styles.page;

  if (loading) {
    return (
      <div className={shellClass}>
        <p className={styles.muted}>Loading session...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={shellClass}>
        <p className={styles.muted}>Redirecting to sign in...</p>
      </div>
    );
  }

  if (!canAccessReview(user.role)) {
    return (
      <div className={shellClass}>
        <h1 className={styles.title}>Review queue</h1>
        <p className={styles.muted}>
          This page is for REVIEWER and MANAGER accounts. Signed in as {user.email} ({user.role}).
        </p>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {embedded ? null : (
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Workspace</p>
            <h1 className={styles.title}>Review queue</h1>
            <p className={styles.lead}>
              Approve draft SOPs, edit step descriptions immediately, and review employee voice
              feedback.
            </p>
          </div>
        </header>
      )}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'sops' ? styles.tabActive : ''}`}
          onClick={() => {
            setTab('sops');
            setEditingSopId(null);
          }}
        >
          SOP queue
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'feedback' ? styles.tabActive : ''}`}
          onClick={() => {
            setTab('feedback');
            setEditingSopId(null);
          }}
        >
          Voice feedback
        </button>
      </div>

      {tab === 'feedback' ? (
        <VoiceFeedbackPanel initialFeedbackId={feedbackId} />
      ) : editingSopId ? (
        <SopStepEditor sopId={editingSopId} onClose={() => setEditingSopId(null)} />
      ) : (
        <>
          {error ? (
            <StateError message={error} code="REV_QUEUE_LOAD" onRetry={() => void loadQueue()} />
          ) : null}

          {loadingQueue ? (
            <StateLoading rows={4} />
          ) : items.length === 0 ? (
            <StateEmpty
              title="No SOPs waiting"
              body="Draft and approved SOPs in this workspace will show up here."
              actionLabel="Open library"
              actionHref="/library"
            />
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
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setEditingSopId(sop.id)}
                    >
                      Edit steps
                    </button>
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
    </div>
  );
}

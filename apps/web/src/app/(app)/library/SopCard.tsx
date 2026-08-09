'use client';

import { useState, type MouseEvent } from 'react';
import Link from 'next/link';
import type { SopLibraryItem } from '@h09a/types';

import { ApiError, deleteSop } from '@/lib/api';

import { LibraryPlayButton } from './library-play-button';
import styles from './library.module.css';

type Props = {
  sop: SopLibraryItem;
  view: 'grid' | 'list';
  canDelete?: boolean;
  onLaunchError?: (message: string) => void;
  onLaunchSuccess?: () => void;
  onDeleteError?: (message: string) => void;
  onDeleted?: () => void;
};

const MAX_DOTS = 10;

// Display an SOP summary card for both published procedures and the user's draft SOPs.
export default function SopCard({
  sop,
  view,
  canDelete = false,
  onLaunchError,
  onLaunchSuccess,
  onDeleteError,
  onDeleted,
}: Props) {
  const [deleting, setDeleting] = useState(false);

  const publishedDate = sop.published_at
    ? new Date(sop.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const dotCount = Math.min(sop.step_count, MAX_DOTS);
  const overflow = sop.step_count - dotCount;

  const statusLabel =
    sop.status === 'published' ? null : sop.status === 'approved' ? 'Approved' : 'Pending Review';

  const canLaunch = sop.status === 'published';

  async function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const confirmed = window.confirm(`Delete "${sop.title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      await deleteSop(sop.id);
      onDeleted?.();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Could not delete this procedure. Try again.';
      onDeleteError?.(message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={view === 'list' ? styles.cardListRow : styles.card}>
      <Link href={`/sop/${sop.id}`} className={styles.cardLink}>
        <span className={styles.cardTab} aria-hidden="true">
          {sop.workflow_category ?? 'Procedure'}
        </span>

        <h2 className={styles.cardTitle}>{sop.title}</h2>

        <div className={styles.cardDivider} aria-hidden="true" />

        <div className={styles.cardFooter}>
          <div
            className={styles.stepDots}
            role="img"
            aria-label={`${sop.step_count} ${sop.step_count === 1 ? 'step' : 'steps'}`}
          >
            {Array.from({ length: dotCount }).map((_, i) => (
              <span key={i} className={styles.dot} />
            ))}
            {overflow > 0 && <span className={styles.dotOverflow}>+{overflow}</span>}
          </div>

          {statusLabel ? (
            <span
              className={sop.status === 'approved' ? styles.approvedStamp : styles.pendingStamp}
            >
              {statusLabel}
            </span>
          ) : (
            publishedDate && (
              <span className={styles.stamp}>
                Verified
                <span className={styles.stampDate}>{publishedDate}</span>
              </span>
            )
          )}
        </div>
      </Link>

      {canDelete || canLaunch ? (
        <div className={styles.cardActions}>
          {canDelete ? (
            <button
              type="button"
              className={styles.deleteButton}
              aria-label={`Delete ${sop.title}`}
              title="Delete"
              disabled={deleting}
              onClick={(event) => void handleDelete(event)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9zm-1 12h12a1 1 0 0 0 1-1V8H5v12a1 1 0 0 0 1 1z"
                />
              </svg>
            </button>
          ) : null}
          {canLaunch ? (
            <LibraryPlayButton sopId={sop.id} onError={onLaunchError} onSuccess={onLaunchSuccess} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

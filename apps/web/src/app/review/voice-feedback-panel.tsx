'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FeedbackNotificationItem, VoiceFeedbackItem } from '@h09a/types';

import {
  ApiError,
  listFeedbackNotifications,
  listVoiceFeedback,
  markFeedbackNotificationRead,
  reviewVoiceFeedback,
} from '@/lib/api';

import styles from './review.module.css';

type FeedbackPanelProps = {
  initialFeedbackId?: string | null;
};

export function VoiceFeedbackPanel({ initialFeedbackId = null }: FeedbackPanelProps) {
  const [items, setItems] = useState<VoiceFeedbackItem[]>([]);
  const [notifications, setNotifications] = useState<FeedbackNotificationItem[]>([]);
  const [severity, setSeverity] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialFeedbackId);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feedbackRes, notificationRes] = await Promise.all([
        listVoiceFeedback(severity ? { severity } : undefined),
        listFeedbackNotifications(true),
      ]);
      setItems(feedbackRes.feedbacks);
      setNotifications(notificationRes.notifications);
      setSelectedId((current) => {
        if (initialFeedbackId) return initialFeedbackId;
        if (current && feedbackRes.feedbacks.some((item) => item.id === current)) {
          return current;
        }
        return feedbackRes.feedbacks[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof ApiError ? loadError.message : 'Failed to load voice feedback.',
      );
    } finally {
      setLoading(false);
    }
  }, [initialFeedbackId, severity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selected) {
      setComment(selected.reviewer_comment ?? '');
      setTags(selected.reviewer_tags.join(', '));
    }
  }, [selected?.id]);

  async function handleSave() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await reviewVoiceFeedback(selected.id, {
        comment: comment.trim() || null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        mark_reviewed: true,
      });
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'Failed to save review.');
    } finally {
      setBusy(false);
    }
  }

  async function openFromNotification(notification: FeedbackNotificationItem) {
    setSelectedId(notification.feedback_id);
    try {
      await markFeedbackNotificationRead(notification.id);
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
    } catch {
      // Keep the panel usable even if read-state update fails.
    }
  }

  return (
    <section className={styles.feedbackPanel}>
      <div className={styles.feedbackToolbar}>
        <label className={styles.filterLabel}>
          Severity
          <select
            className={styles.select}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {notifications.length > 0 ? (
        <div className={styles.noticeList}>
          {notifications.map((notification) => (
            <button
              key={notification.id}
              type="button"
              className={styles.noticeItem}
              onClick={() => void openFromNotification(notification)}
            >
              {notification.title}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Loading voice feedback...</p>
      ) : items.length === 0 ? (
        <section className={styles.empty}>
          <h2>No voice feedback yet</h2>
          <p>Uploads from employees will appear here for review.</p>
        </section>
      ) : (
        <div className={styles.feedbackLayout}>
          <ul className={styles.feedbackList}>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${styles.feedbackListItem} ${
                    item.id === selectedId ? styles.feedbackListItemActive : ''
                  }`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className={styles.status}>{item.severity}</span>
                  <strong>{item.sop_title}</strong>
                  <span className={styles.cardId}>{item.classification}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <article className={styles.feedbackDetail}>
              <h2 className={styles.cardTitle}>{selected.sop_title}</h2>
              <p className={styles.userMeta}>
                {selected.employee_email} · {selected.classification} · {selected.severity} ·{' '}
                {selected.status}
              </p>
              {selected.audio_url ? (
                <audio className={styles.audioPlayer} controls src={selected.audio_url}>
                  <track kind="captions" />
                </audio>
              ) : null}
              <p className={styles.transcript}>{selected.transcript}</p>
              <label className={styles.filterLabel}>
                Reviewer comment
                <textarea
                  className={styles.textarea}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={4}
                />
              </label>
              <label className={styles.filterLabel}>
                Tags (comma separated)
                <input
                  className={styles.input}
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => void handleSave()}
              >
                {busy ? 'Saving...' : 'Mark reviewed'}
              </button>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}

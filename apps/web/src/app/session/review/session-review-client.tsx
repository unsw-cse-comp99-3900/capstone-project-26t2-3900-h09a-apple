'use client';

import type { EventType, SessionUploadPayload, WTEventInput } from '@h09a/types';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import styles from './session-review.module.css';

type SessionReviewClientProps = {
  sessionId: string;
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
type LoadState = 'loading' | 'loaded' | 'error';

type ExtensionSessionResponse = {
  ok: boolean;
  session?: SessionUploadPayload | null;
  error?: string;
};

const EVENT_ICONS: Record<EventType, ReactNode> = {
  click: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 9l5 12 1.8-5.2L21 14 9 9Z" />
      <path d="M7.2 4.8 8 7" />
      <path d="M4.8 7.2 7 8" />
      <path d="M4.8 12.8 7 12" />
      <path d="M7.2 15.2 8 13" />
    </svg>
  ),
  navigation: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </svg>
  ),
  input: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M18 14h0" />
      <path d="M9.5 14h5" />
    </svg>
  ),
  submit: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 10 17 19 7" />
    </svg>
  ),
  tab_switch: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
};

const EVENT_LABELS: Record<EventType, string> = {
  click: 'Click',
  navigation: 'Navigation',
  input: 'Input',
  submit: 'Submit',
  tab_switch: 'Tab switch',
};

function requestSessionFromExtension(sessionId: string): Promise<SessionUploadPayload | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !sessionId) {
      resolve(null);
      return;
    }

    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error('Timed out waiting for the WorkTrace extension'));
    }, 2000);

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== 'worktrace-extension') {
        return;
      }

      if (event.data.type !== 'GET_SESSION_PAYLOAD_RESULT' || event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);

      const response = event.data.response as ExtensionSessionResponse | undefined;
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'The WorkTrace extension could not load this session'));
        return;
      }

      resolve(response.session ?? null);
    }

    window.addEventListener('message', handleMessage);
    window.postMessage(
      {
        source: 'worktrace-web',
        type: 'GET_SESSION_PAYLOAD',
        requestId,
        sessionId,
      },
      window.location.origin,
    );
  });
}

function formatDuration(startedAt: string, stoppedAt?: string | null): string {
  if (!stoppedAt) {
    return 'In progress';
  }

  const durationMs = Math.max(0, new Date(stoppedAt).getTime() - new Date(startedAt).getTime());
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatEventTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestampMs));
}

function describeEvent(event: WTEventInput): string {
  if (event.type === 'navigation') {
    return event.url ?? 'Navigated to a new page';
  }

  if (event.type === 'input') {
    const target = event.target_label ?? event.target_selector ?? 'field';
    return `Entered ${event.value ?? 'a value'} in ${target}`;
  }

  if (event.type === 'click') {
    return event.target_label ?? event.target_selector ?? 'Clicked page element';
  }

  if (event.type === 'submit') {
    return event.target_label ?? event.target_selector ?? 'Submitted form';
  }

  return event.url ?? 'Switched browser tab';
}

export function SessionReviewClient({ sessionId }: SessionReviewClientProps) {
  const [session, setSession] = useState<SessionUploadPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(sessionId ? 'loading' : 'error');
  const [loadMessage, setLoadMessage] = useState(
    sessionId
      ? 'Loading captured session from the WorkTrace extension...'
      : 'Missing session id. Open this page from the WorkTrace extension after stopping a recording.',
  );
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const duration = session
    ? formatDuration(session.started_at, session.stopped_at)
    : 'Not available';
  const isLoading = loadState === 'loading';

  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      setSession(null);
      setLoadState('error');
      setLoadMessage(
        'Missing session id. Open this page from the WorkTrace extension after stopping a recording.',
      );
      return;
    }

    setLoadState('loading');
    setLoadMessage('Loading captured session from the WorkTrace extension...');

    requestSessionFromExtension(sessionId)
      .then((capturedSession) => {
        if (cancelled) {
          return;
        }

        if (capturedSession) {
          setSession(capturedSession);
          setLoadState('loaded');
          setLoadMessage('Loaded captured session from the WorkTrace AI extension.');
          return;
        }

        setSession(null);
        setLoadState('error');
        setLoadMessage('No captured session was found for this id.');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSession(null);
        setLoadState('error');
        setLoadMessage(error instanceof Error ? error.message : 'Unable to load captured session.');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSubmit() {
    setSubmitState('submitting');
    setErrorMessage('');

    if (!session) {
      setSubmitState('error');
      setErrorMessage('No captured session is loaded.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      setSubmitState('success');
      window.location.href = `/sop/status?sessionId=${encodeURIComponent(session.client_session_id)}`;
    } catch (error) {
      setSubmitState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Session submission failed');
    }
  }

  return (
    <main className={styles.pageShell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Session review</p>
          <h1>Review captured workflow</h1>
          <p className={styles.heroCopy}>
            Confirm the captured timeline before sending this session to WorkTrace AI for SOP
            generation.
          </p>
        </div>
        <div className={styles.statusPill}>
          {loadState === 'loaded' ? 'Ready to submit' : 'Session unavailable'}
        </div>
      </section>

      <div className={`${styles.loadNotice} ${styles[loadState]}`} role="status">
        {loadMessage}
      </div>

      {session ? (
        <>
          <section className={styles.summaryGrid} aria-label="Session summary">
            <article className={styles.summaryCard}>
              <span>Session name</span>
              <strong>{session.workflow_name}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Duration</span>
              <strong>{duration}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span>Event count</span>
              <strong>{session.events.length}</strong>
            </article>
          </section>

          <section className={styles.reviewPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Captured events</p>
                <h2>Timeline</h2>
              </div>
              <span className={styles.sessionId}>ID: {session.client_session_id}</span>
            </div>

            {session.events.length > 0 ? (
              <ol className={styles.timeline} aria-label="Captured event timeline">
                {session.events.map((event, index) => (
                  <li
                    className={styles.timelineItem}
                    key={`${event.timestamp_ms}-${event.type}-${index}`}
                  >
                    <div className={styles.eventIcon} aria-hidden="true">
                      {EVENT_ICONS[event.type]}
                    </div>
                    <div className={styles.eventContent}>
                      <div className={styles.eventTopline}>
                        <strong>{EVENT_LABELS[event.type]}</strong>
                        <time dateTime={new Date(event.timestamp_ms).toISOString()}>
                          {formatEventTime(event.timestamp_ms)}
                        </time>
                      </div>
                      <p>{describeEvent(event)}</p>
                      {event.url ? <span className={styles.eventUrl}>{event.url}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={styles.emptyState}>
                This captured session does not contain events.
              </div>
            )}
          </section>
        </>
      ) : (
        <section className={styles.emptyState}>
          <h2>No captured session loaded</h2>
          <p>Stop a recording in the WorkTrace extension, then open Review Session again.</p>
        </section>
      )}

      {errorMessage ? (
        <div className={styles.errorBox} role="alert">
          <strong>Submission failed.</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <footer className={styles.actionBar}>
        <p>Screenshot previews and event editing are intentionally out of scope for Sprint 1.</p>
        <button
          className={styles.submitButton}
          disabled={
            isLoading || !session || submitState === 'submitting' || session.events.length === 0
          }
          type="button"
          onClick={handleSubmit}
        >
          {submitState === 'submitting' ? 'Submitting...' : 'Submit for SOP generation'}
        </button>
      </footer>
    </main>
  );
}

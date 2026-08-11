'use client';

/**
 * Polls SOP generation status after session submit and offers retry on failure.
 */

import type { SessionStatusResponse } from '@h09a/types';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSessionStatus, retryGenerateSop } from '@/lib/api';
import styles from './generating.module.css';

type GeneratingClientProps = {
  sessionId: string;
};

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 90000;
const BUDGET_SECONDS = 60;

const STAGES = [
  {
    id: 'parse',
    label: 'Parse',
    description: 'Reading captured workflow events',
  },
  {
    id: 'segment',
    label: 'Segment',
    description: 'Grouping actions into meaningful steps',
  },
  {
    id: 'draft',
    label: 'Draft',
    description: 'Drafting the SOP instructions',
  },
  {
    id: 'detect',
    label: 'Detect',
    description: 'Checking for warnings and gaps',
  },
  {
    id: 'render',
    label: 'Render',
    description: 'Preparing the review draft',
  },
] as const;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function errorMessageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function GeneratingClient({ sessionId }: GeneratingClientProps) {
  const router = useRouter();
  const startedAtRef = useRef(Date.now());
  const generationRequestedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatusResponse | null>(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);

  const budgetProgress = Math.min((elapsedSeconds / BUDGET_SECONDS) * 100, 100);
  const activeStageIndex = Math.min(
    Math.floor((budgetProgress / 100) * STAGES.length),
    STAGES.length - 1,
  );
  const currentStage = STAGES[activeStageIndex];
  const jobStatus = sessionStatus?.job_status ?? 'pending';

  const resetProgress = useCallback(() => {
    startedAtRef.current = Date.now();
    generationRequestedRef.current = false;
    setElapsedSeconds(0);
    setErrorMessage('');
    setHasError(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
  }, [attempt]);

  useEffect(() => {
    if (hasError) {
      return undefined;
    }

    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, [attempt, hasError]);

  useEffect(() => {
    if (hasError) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setHasError(true);
      setErrorMessage('SOP generation is taking longer than expected. Try again to restart it.');
    }, TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [attempt, hasError]);

  useEffect(() => {
    if (hasError) {
      return undefined;
    }

    let cancelled = false;

    async function pollStatus() {
      try {
        const nextStatus = await getSessionStatus(sessionId);

        if (cancelled) {
          return;
        }

        setSessionStatus(nextStatus);

        if (nextStatus.job_status === 'pending' && !generationRequestedRef.current) {
          generationRequestedRef.current = true;
          await retryGenerateSop(sessionId);
          return;
        }

        if (nextStatus.job_status === 'completed') {
          if (nextStatus.sop_id) {
            router.replace(`/sop/${nextStatus.sop_id}`);
            return;
          }

          setHasError(true);
          setErrorMessage('SOP generation completed, but no SOP draft id was returned.');
          return;
        }

        if (nextStatus.job_status === 'failed') {
          setHasError(true);
          setErrorMessage('SOP generation failed. Try again to restart it.');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setHasError(true);
        setErrorMessage(errorMessageFrom(error, 'Unable to load SOP generation status.'));
      }
    }

    void pollStatus();
    const pollTimer = window.setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [attempt, hasError, router, sessionId]);

  const statusCopy = useMemo(() => {
    if (hasError) {
      return 'Generation needs attention';
    }

    if (jobStatus === 'processing') {
      return 'Generating SOP draft';
    }

    if (jobStatus === 'completed') {
      return 'Redirecting to draft';
    }

    return 'Waiting for generation';
  }, [hasError, jobStatus]);

  async function handleRetry() {
    setIsRetrying(true);
    setErrorMessage('');

    try {
      await retryGenerateSop(sessionId);
      resetProgress();
    } catch (error) {
      setHasError(true);
      setErrorMessage(errorMessageFrom(error, 'Unable to restart SOP generation.'));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <main className={styles.pageShell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>WorkTrace AI</p>
          <h1>{statusCopy}</h1>
          <p className={styles.heroCopy}>
            Keep this page open while WorkTrace turns the captured workflow into a reviewable SOP
            draft.
          </p>
        </div>
        <div className={`${styles.statusPill} ${hasError ? styles.errorPill : ''}`}>
          {hasError ? 'Action needed' : jobStatus}
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label="SOP generation summary">
        <article className={styles.summaryCard}>
          <span>Workflow</span>
          <strong>{sessionStatus?.workflow_name ?? 'Loading...'}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Elapsed time</span>
          <strong>{formatElapsed(elapsedSeconds)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Session ID</span>
          <strong title={sessionId}>{sessionId}</strong>
        </article>
      </section>

      {hasError ? (
        <section className={styles.errorCard} role="alert">
          <div>
            <p className={styles.eyebrow}>Generation paused</p>
            <h2>We could not finish this SOP yet.</h2>
            <p>{errorMessage}</p>
          </div>
          <button
            className={styles.retryButton}
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? 'Retrying...' : 'Retry generation'}
          </button>
        </section>
      ) : (
        <section className={styles.progressPanel} aria-label="Generation progress">
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Pseudo progress</p>
              <h2>{currentStage.label}</h2>
              <p>{currentStage.description}</p>
            </div>
            <span>{Math.round(budgetProgress)}% of 60s budget</span>
          </div>

          <div className={styles.progressTrack} aria-hidden="true">
            <div className={styles.progressFill} style={{ width: `${budgetProgress}%` }} />
          </div>

          <ol className={styles.stageList}>
            {STAGES.map((stage, index) => (
              <li
                className={`${styles.stageItem} ${index <= activeStageIndex ? styles.stageActive : ''}`}
                key={stage.id}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

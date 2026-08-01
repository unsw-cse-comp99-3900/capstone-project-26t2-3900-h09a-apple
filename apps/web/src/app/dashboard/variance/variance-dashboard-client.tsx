'use client';

import type { FrictionWorkflowListResponse } from '@h09a/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';
import {
  ApiError,
  createFrictionWsTicket,
  frictionWebSocketUrl,
  getFrictionWorkflowList,
} from '@/lib/api';

import styles from './variance.module.css';
import { WorkflowFrictionCard } from './workflow-friction-card';

type VarianceDashboardClientProps = {
  initialList?: FrictionWorkflowListResponse | null;
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function VarianceDashboardClient({ initialList = null }: VarianceDashboardClientProps) {
  const { user, loading: loadingUser, logout } = useCurrentUser();
  const [list, setList] = useState<FrictionWorkflowListResponse | null>(initialList);
  const [loadingList, setLoadingList] = useState(initialList === null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      setList(await getFrictionWorkflowList());
    } catch (loadError: unknown) {
      setError(errorText(loadError, 'Failed to load workflow friction rankings.'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (loadingUser || user?.role !== 'MANAGER') {
      return;
    }
    if (initialList) {
      setList(initialList);
      setLoadingList(false);
      return;
    }
    void refreshList();
  }, [initialList, loadingUser, refreshList, user?.role]);

  useEffect(() => {
    if (loadingUser || user?.role !== 'MANAGER') {
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (active) reconnectTimer = setTimeout(() => void connect(), 3_000);
    };

    const connect = async () => {
      try {
        const wsTicket = await createFrictionWsTicket();
        if (!active) return;
        socket = new WebSocket(frictionWebSocketUrl(wsTicket.ticket, wsTicket.ws_path));
        socket.onmessage = (message) => {
          try {
            const update = JSON.parse(message.data as string) as {
              event?: string;
              status?: string;
            };
            if (update.event === 'friction_analysis.updated') {
              setNotice(
                update.status === 'completed'
                  ? 'Friction rankings updated.'
                  : `Friction analysis ${update.status ?? 'updated'}.`,
              );
              void refreshList();
            }
          } catch {
            // Ignore heartbeat or malformed messages.
          }
        };
        socket.onclose = scheduleReconnect;
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [loadingUser, refreshList, user?.role]);

  if (loadingUser) {
    return (
      <main className={styles.page}>
        <p className={styles.state}>Loading session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.state}>Redirecting to sign in...</p>
      </main>
    );
  }

  if (user.role !== 'MANAGER') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Variance dashboard</h1>
        <p className={styles.state}>This dashboard is available to manager accounts only.</p>
        <button className={styles.secondaryButton} type="button" onClick={() => void logout()}>
          Log out
        </button>
      </main>
    );
  }

  const workflows = list?.workflows ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Manager analytics</p>
          <h1 className={styles.title}>Variance dashboard</h1>
          <p className={styles.lead}>
            Ranked workflows by aggregate friction, with step charts and a one-line executive
            insight so you can prioritise the highest-impact coaching.
          </p>
        </div>
        <div className={styles.account}>
          <Link className={styles.secondaryButton} href="/dashboard/variance/clustering">
            Clustering
          </Link>
          <Link className={styles.secondaryButton} href="/dashboard/feedback">
            Voice feedback
          </Link>
          <button className={styles.secondaryButton} type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {notice ? (
        <p className={styles.notification} role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loadingList ? (
        <section className={styles.stateCard} aria-live="polite">
          <h2>Loading friction rankings...</h2>
          <p>Fetching aggregate scores and insight teasers for published workflows.</p>
        </section>
      ) : workflows.length === 0 ? (
        <section className={styles.stateCard}>
          <h2>No published workflows</h2>
          <p>Publish an SOP to start tracking friction across walkthrough sessions.</p>
        </section>
      ) : (
        <section className={styles.workflowList} aria-label="Workflows ranked by friction">
          {workflows.map((workflow) => (
            <WorkflowFrictionCard key={workflow.workflow_id} workflow={workflow} />
          ))}
        </section>
      )}
    </main>
  );
}

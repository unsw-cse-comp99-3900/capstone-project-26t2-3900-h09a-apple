'use client';

import type { SopDetailPayload, SopStepResponse } from '@h09a/types';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';
import { getSop } from '@/lib/api';

import styles from './floating-assistant.module.css';

type AssistantMode = 'auto' | 'manual';
type AssistantTab = 'prompt' | 'qa' | 'voice' | 'undo';

const tabs: Array<{ id: AssistantTab; label: string }> = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'qa', label: 'Q&A' },
  { id: 'voice', label: 'Voice' },
  { id: 'undo', label: 'Undo' },
];

function sopIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/sop\/([^/]+)$/);
  return match?.[1] ?? null;
}

function stepLabel(step: SopStepResponse | null): string {
  if (!step) return 'No SOP step detected';
  return `Step ${step.order}: ${step.title}`;
}

function initialsFor(email: string): string {
  const name = email.split('@')[0]?.trim();
  if (!name || /^\d/.test(name)) return 'WT';

  return (
    name
      .split(/[._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'WT'
  );
}

export function FloatingAssistant() {
    const { user, loading } = useCurrentUser();
		const pathname = usePathname();
		const [expanded, setExpanded] = useState(false);
		const [maximized, setMaximized] = useState(false);
		const [mode, setMode] = useState<AssistantMode>('auto');
		const [tab, setTab] = useState<AssistantTab>('prompt');
		const [sop, setSop] = useState<SopDetailPayload | null>(null);
		const [activeStepIndex, setActiveStepIndex] = useState(0);
		const [sopLoading, setSopLoading] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const displayName = useMemo(() => {
    if (!user?.email) return 'WorkTrace user';
    return user.email.split('@')[0] || user.email;
  }, [user?.email]);

	const orderedSteps = useMemo(() => {
		return [...(sop?.steps ?? [])].sort((left, right) => left.order - right.order);
	}, [sop?.steps]);

	const currentStep = orderedSteps[activeStepIndex] ?? null;

	useEffect(() => {
		const sopId = sopIdFromPath(pathname);

		if (!sopId || !user) {
			setSop(null);
			setActiveStepIndex(0);
			return;
		}

		let cancelled = false;
		setSopLoading(true);

		void getSop(sopId)
			.then((payload) => {
				if (!cancelled) {
					setSop(payload);
					setActiveStepIndex(0);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSop(null);
					setActiveStepIndex(0);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setSopLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [pathname, user]);
  if (loading || !user) {
    return null;
  }

  return (
    <aside
      className={styles.shell}
      data-expanded={expanded}
      data-maximized={maximized}
      aria-label="WorkTrace assistant"
    >
      <button
        className={styles.orb}
        type="button"
        aria-label={expanded ? 'Collapse WorkTrace assistant' : 'Open WorkTrace assistant'}
        aria-expanded={expanded}
        onClick={() => {
					setExpanded((current) => !current);
					if (expanded) {
						setMaximized(false);
					}
				}}
      >
        <span className={styles.orbLetter}>W</span>
        <span className={styles.orbStatus} aria-hidden="true" />
      </button>

      {expanded ? (
        <section className={styles.panel}>
          <header className={styles.header}>
            <div className={styles.avatar} aria-hidden="true">
              {initialsFor(user.email)}
            </div>

            <div className={styles.userText}>
              <p>{displayName}</p>
              <span>{user.role}</span>
            </div>

            <div className={styles.headerActions}>
              <button
                type="button"
                onClick={() => {
									setExpanded(false);
									setMaximized(false);
								}}
                aria-label="Minimize assistant"
              >
                -
              </button>
              <button
								type="button"
								aria-label={maximized ? 'Restore assistant size' : 'Maximize assistant'}
								onClick={() => setMaximized((current) => !current)}
							>
								{maximized ? '↙' : '+'}
							</button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Close assistant"
              >
                x
              </button>
            </div>
          </header>

          <div className={styles.modeToggle} role="group" aria-label="Walkthrough mode">
            <button
              type="button"
              className={mode === 'auto' ? styles.activeMode : undefined}
              onClick={() => setMode('auto')}
            >
              Auto Walkthrough
            </button>

            <button
              type="button"
              className={mode === 'manual' ? styles.activeMode : undefined}
              onClick={() => setMode('manual')}
            >
              Manual Guide
            </button>
          </div>

          <nav className={styles.tabs} aria-label="Assistant tools">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? styles.activeTab : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className={styles.content}>
            {tab === 'prompt' ? (
							<div>
								<p className={styles.kicker}>Prompt Coaching</p>
								<h2>{sopLoading ? 'Loading SOP context...' : stepLabel(currentStep)}</h2>
								<p>
									{currentStep
										? currentStep.instruction
										: 'Open an SOP page to let the assistant read the current walkthrough step.'}
								</p>

								{currentStep ? (
									<div className={styles.stepControls}>
										<button
											type="button"
											disabled={activeStepIndex === 0}
											onClick={() => setActiveStepIndex((index) => Math.max(0, index - 1))}
										>
											Previous
										</button>
										<span>
											{activeStepIndex + 1} / {orderedSteps.length}
										</span>
										<button
											type="button"
											disabled={activeStepIndex >= orderedSteps.length - 1}
											onClick={() =>
												setActiveStepIndex((index) => Math.min(orderedSteps.length - 1, index + 1))
											}
										>
											Next
										</button>
									</div>
								) : null}

								<button className={styles.primaryAction} type="button">
									Generate suggestion
								</button>
							</div>
						) : null}

            {tab === 'qa' ? (
              <div>
                <p className={styles.kicker}>Q&A</p>
                <h2>Ask about the current workflow.</h2>
                <textarea placeholder="Ask what to do next..." rows={4} />
                <button className={styles.primaryAction} type="button">
                  Ask assistant
                </button>
              </div>
            ) : null}

            {tab === 'voice' ? (
              <div>
                <p className={styles.kicker}>Voice Feedback</p>
                <h2>Record feedback for this step.</h2>
                <p>Voice upload will connect to the feedback backend when H09AAPPLE-33 is ready.</p>
                <button className={styles.primaryAction} type="button">
                  Start recording
                </button>
              </div>
            ) : null}

            {tab === 'undo' ? (
              <div>
                <p className={styles.kicker}>Recovery</p>
                <h2>Get back on track.</h2>
                <p>
                  Recovery guidance will appear here when the assistant detects an off-path action.
                </p>
                <button className={styles.primaryAction} type="button">
                  Show recovery steps
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
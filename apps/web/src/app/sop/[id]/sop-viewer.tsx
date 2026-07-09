import type { SopDetailPayload, SopStepResponse, SopWarning } from '@h09a/types';
import Image from 'next/image';
import React from 'react';
import styles from './sop-viewer.module.css';
import { formatTimeEstimate } from '@/lib/time-estimate';

export type SopStepCardProps = {
  stepNumber: number;
  title: string;
  instruction: string;
  warning?: string | null;
  branch?: string | null;
  screenshotUrl?: string | null;
  timeEstimate?: number | null;
  screenshotHighlight?: SopStepResponse['screenshot_highlight'];
};

type SopViewerProps = {
  sop: SopDetailPayload;
};

function formatGenerationTime(generatedAt: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(generatedAt));
}

function warningForStep(step: SopStepResponse, warnings: SopWarning[]): string | null {
  const stepEventIds = new Set(step.source_event_ids);
  const matchingWarnings = warnings.filter((warning) =>
    warning.source_event_ids.some((eventId) => stepEventIds.has(eventId)),
  );

  if (matchingWarnings.length === 0) {
    return null;
  }

  return matchingWarnings.map((warning) => warning.message).join(' ');
}

function branchForStep(step: SopStepResponse): string | null {
  const branch = step.branch;
  return branch?.trim() ? branch : null;
}

function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/, '');
}

function looksLikeUrl(value: string): boolean {
  const trimmed = stripTrailingSentencePunctuation(value.trim());

  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }

  return /^(?:www\.|localhost(?:[:/]|$)|[\w-]+\.[\w.-]+(?:[/:?#]|$))/i.test(trimmed);
}

function cleanUrlForDisplay(value: string): string {
  const trimmed = stripTrailingSentencePunctuation(value.trim());
  const parseable = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(parseable);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.hostname}${path}`;
  } catch {
    return trimmed.split(/[?#]/, 1)[0];
  }
}

function splitLeadingOpenUrl(instruction: string): {
  subtitle: string | null;
  subtitleTitle: string | null;
  instruction: string;
} {
  const trimmed = instruction.trim();
  const match = trimmed.match(/^Open\s+(\S+)(?:\s|$)/i);

  if (!match || !looksLikeUrl(match[1])) {
    return { subtitle: null, subtitleTitle: null, instruction };
  }

  const rawUrl = match[1];
  const subtitle = cleanUrlForDisplay(rawUrl);
  const subtitleTitle = stripTrailingSentencePunctuation(rawUrl);
  const leadingSentence = `Open ${rawUrl}`;
  const withoutLeadingOpen = trimmed
    .slice(leadingSentence.length)
    .replace(/^[.,;:!?\s]+/, '')
    .trim();

  return {
    subtitle,
    subtitleTitle,
    instruction: withoutLeadingOpen || instruction,
  };
}

function stepDisplayText(title: string, instruction: string) {
  const titleIsUrl = looksLikeUrl(title);
  const openUrl = splitLeadingOpenUrl(instruction);

  return {
    title: titleIsUrl ? 'Open page' : title,
    subtitle: titleIsUrl ? cleanUrlForDisplay(title) : openUrl.subtitle,
    subtitleTitle: titleIsUrl ? stripTrailingSentencePunctuation(title) : openUrl.subtitleTitle,
    instruction:
      titleIsUrl && openUrl.instruction === instruction ? 'Open the page.' : openUrl.instruction,
  };
}

function highlightStyle(highlight: NonNullable<SopStepResponse['screenshot_highlight']>) {
  return {
    left: `${(highlight.x / highlight.viewport_width) * 100}%`,
    top: `${(highlight.y / highlight.viewport_height) * 100}%`,
    width: `${(highlight.width / highlight.viewport_width) * 100}%`,
    height: `${(highlight.height / highlight.viewport_height) * 100}%`,
  };
}

export function SopStepCard({
  stepNumber,
  title,
  instruction,
  warning,
  branch,
  screenshotUrl,
  timeEstimate,
  screenshotHighlight,
}: SopStepCardProps) {
  const display = stepDisplayText(title, instruction);

  return (
    <article className={styles.stepCard}>
      <div className={styles.stepContent}>
        <div className={styles.stepNumber} aria-label={`Step ${stepNumber}`}>
          {stepNumber}
        </div>

        <div>
          <div className={styles.stepTopline}>
            <p className={styles.eyebrow}>Step {stepNumber}</p>
          </div>
          <h2>{display.title}</h2>
          {display.subtitle ? (
            <p className={styles.stepSubtitle} title={display.subtitleTitle ?? display.subtitle}>
              {display.subtitle}
            </p>
          ) : null}
          <p className={styles.instruction}>{display.instruction}</p>

          {timeEstimate != null ? (
            <p className={styles.timeEstimate}>
              Estimated time: {formatTimeEstimate(timeEstimate)}
            </p>
          ) : null}

          {warning ? (
            <div className={`${styles.callout} ${styles.warningCallout}`} role="note">
              <strong>Warning</strong>
              <p>{warning}</p>
            </div>
          ) : null}

          {branch ? (
            <div className={`${styles.callout} ${styles.branchCallout}`} role="note">
              <strong>Branch</strong>
              <p>{branch}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.screenshotFrame}>
        {screenshotUrl ? (
          <div className={styles.screenshotImageWrap}>
            <Image
              className={styles.screenshotImage}
              src={screenshotUrl}
              alt={`Screenshot for step ${stepNumber}: ${title}`}
              width={640}
              height={420}
              unoptimized
            />
            {screenshotHighlight ? (
              <span
                className={styles.screenshotHighlight}
                style={highlightStyle(screenshotHighlight)}
                aria-hidden="true"
              />
            ) : null}
          </div>
) : (
          <div className={styles.screenshotPlaceholder}>
            <span aria-hidden="true">WT</span>
            <p>No screenshot captured for this step</p>
          </div>
        )}
      </div>
    </article>
  );
}

export function SopViewer({ sop }: SopViewerProps) {
  const orderedSteps = [...sop.steps].sort((left, right) => left.order - right.order);
  const generatedAt = formatGenerationTime(sop.generated_at);

  return (
    <main className={styles.pageShell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>WorkTrace SOP draft</p>
          <h1>{sop.title}</h1>
          <p className={styles.heroCopy}>{sop.summary}</p>
        </div>
        <div className={styles.aiBadge}>AI generated</div>
      </section>

      <section className={styles.summaryGrid} aria-label="SOP summary">
        <article className={styles.summaryCard}>
          <span>Version</span>
          <strong>v{sop.version}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Steps</span>
          <strong>{orderedSteps.length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Generated</span>
          <strong>{generatedAt}</strong>
        </article>
      </section>

      <section className={styles.stepsPanel} aria-label="SOP steps">
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Review draft</p>
            <h2>Procedure steps</h2>
          </div>
          <span>{orderedSteps.length} total</span>
        </div>

        <ol className={styles.stepList}>
          {orderedSteps.map((step) => (
            <li key={`${step.order}-${step.title}`}>
              <SopStepCard
                stepNumber={step.order}
                title={step.title}
                instruction={step.instruction}
                warning={warningForStep(step, sop.warnings)}
                branch={branchForStep(step)}
                screenshotUrl={step.screenshot_url}
                timeEstimate={step.time_estimate}
              />
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

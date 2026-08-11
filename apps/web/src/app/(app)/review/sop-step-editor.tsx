'use client';

/**
 * Inline editor for reviewer edits to SOP step instructions.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SopDetailPayload } from '@h09a/types';

import { StateEmpty } from '@/components/ui/state-empty';
import { StateError } from '@/components/ui/state-error';
import { StateLoading } from '@/components/ui/state-loading';
import {
  ApiError,
  getSop,
  getSopStepEdits,
  patchSopStepInstruction,
  type SopStepEditLogItem,
} from '@/lib/api';

import styles from './review.module.css';

type SopStepEditorProps = {
  sopId: string;
  onClose: () => void;
};

export function SopStepEditor({ sopId, onClose }: SopStepEditorProps) {
  const [sop, setSop] = useState<SopDetailPayload | null>(null);
  const [edits, setEdits] = useState<SopStepEditLogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingStep, setSavingStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, history] = await Promise.all([getSop(sopId), getSopStepEdits(sopId)]);
      setSop(detail);
      setEdits(history.edits);
      const next: Record<number, string> = {};
      for (const step of detail.steps) {
        next[step.order] = step.instruction;
      }
      setDrafts(next);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'Failed to load SOP steps.');
    } finally {
      setLoading(false);
    }
  }, [sopId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveStep(stepNumber: number) {
    const instruction = (drafts[stepNumber] || '').trim();
    if (!instruction) {
      setError('Step description cannot be empty.');
      return;
    }
    setSavingStep(stepNumber);
    setError(null);
    setNotice(null);
    try {
      await patchSopStepInstruction(sopId, stepNumber, instruction);
      setNotice(`Step ${stepNumber} saved. The change is live immediately.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'Failed to save step.');
    } finally {
      setSavingStep(null);
    }
  }

  return (
    <section className={styles.editorPanel} aria-label="SOP step editor">
      <div className={styles.editorHeader}>
        <div>
          <p className={styles.eyebrow}>Step editing</p>
          <h2 className={styles.editorTitle}>{sop?.title ?? 'SOP steps'}</h2>
          <p className={styles.muted}>
            Edit any step description. Changes apply immediately and are logged with before/after
            text.
          </p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          Close editor
        </button>
      </div>

      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <StateLoading rows={4} />
      ) : error && !sop ? (
        <StateError message={error} code="REV_STEP_LOAD" onRetry={() => void load()} />
      ) : !sop?.steps.length ? (
        <StateEmpty title="No steps" body="This SOP has no editable steps yet." />
      ) : (
        <ul className={styles.editorList}>
          {sop.steps.map((step) => (
            <li key={step.order} className={styles.editorCard}>
              <div className={styles.editorCardTop}>
                <strong>
                  Step {step.order}: {step.title}
                </strong>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={savingStep === step.order}
                  onClick={() => void saveStep(step.order)}
                >
                  {savingStep === step.order ? 'Saving...' : 'Save description'}
                </button>
              </div>
              <label className={styles.editorLabel} htmlFor={`step-${step.order}`}>
                Description
              </label>
              <textarea
                id={`step-${step.order}`}
                className={styles.editorTextarea}
                rows={3}
                value={drafts[step.order] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [step.order]: event.target.value }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className={styles.editHistory}>
        <h3>Edit history</h3>
        {edits.length === 0 ? (
          <p className={styles.muted}>No edits logged yet for this SOP.</p>
        ) : (
          <ul className={styles.historyList}>
            {edits.map((edit) => (
              <li key={edit.id}>
                <p className={styles.historyMeta}>
                  Step {edit.step_number} · {new Date(edit.created_at).toLocaleString()}
                  {edit.editor_id ? ` · editor ${edit.editor_id.slice(0, 8)}` : ''}
                </p>
                <p className={styles.historyBefore}>Before: {edit.before_text}</p>
                <p className={styles.historyAfter}>After: {edit.after_text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

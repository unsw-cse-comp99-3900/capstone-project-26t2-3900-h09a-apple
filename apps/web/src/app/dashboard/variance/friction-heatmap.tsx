'use client';

import type { FrictionStepChartPoint } from '@h09a/types';
import { useState } from 'react';

import { frictionHeatColor, stepLabel } from './chart-utils';
import styles from './variance.module.css';

type FrictionHeatmapProps = {
  steps: FrictionStepChartPoint[];
};

export function FrictionHeatmap({ steps }: FrictionHeatmapProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (steps.length === 0) {
    return <p className={styles.chartEmpty}>No step scores yet</p>;
  }

  const active =
    hovered === null ? null : (steps.find((step) => step.step_number === hovered) ?? null);

  return (
    <div className={styles.heatmap} aria-label="Friction heatmap by step">
      <div className={styles.heatmapRow}>
        {steps.map((step) => {
          const isActive = hovered === step.step_number;
          return (
            <button
              key={step.step_number}
              type="button"
              className={`${styles.heatmapCell} ${step.variance_flag ? styles.heatmapCellFlagged : ''} ${
                isActive ? styles.heatmapCellActive : ''
              }`}
              style={{ backgroundColor: frictionHeatColor(step.average_score, step.variance_flag) }}
              onMouseEnter={() => setHovered(step.step_number)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(step.step_number)}
              onBlur={() => setHovered(null)}
              aria-label={`${stepLabel(step)}, friction ${step.average_score.toFixed(0)}${
                step.variance_flag ? ', high variance' : ''
              }`}
            >
              <span className={styles.heatmapStep}>S{step.step_number}</span>
              <span className={styles.heatmapScore}>{step.average_score.toFixed(0)}</span>
            </button>
          );
        })}
      </div>
      {active ? (
        <div className={styles.chartTooltip} role="status">
          <strong>{stepLabel(active)}</strong>
          <p>{active.instruction?.trim() || 'No instruction text for this step.'}</p>
          <p>
            Friction {active.average_score.toFixed(0)}
            {active.variance_flag ? ' · HIGH VARIANCE' : ''}
          </p>
        </div>
      ) : (
        <p className={styles.chartHint}>Hover a step to read its instruction.</p>
      )}
    </div>
  );
}

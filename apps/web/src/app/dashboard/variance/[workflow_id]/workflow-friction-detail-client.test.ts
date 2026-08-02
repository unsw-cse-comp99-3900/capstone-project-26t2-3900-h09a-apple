import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detailSource = readFileSync(
  new URL('./workflow-friction-detail-client.tsx', import.meta.url),
  'utf-8',
);
const heatmapSource = readFileSync(new URL('../friction-heatmap.tsx', import.meta.url), 'utf-8');
const pathSource = readFileSync(new URL('../path-comparison-chart.tsx', import.meta.url), 'utf-8');
const bestSource = readFileSync(new URL('../best-vs-average-chart.tsx', import.meta.url), 'utf-8');
const utilsSource = readFileSync(new URL('../chart-utils.ts', import.meta.url), 'utf-8');

describe('variance drill-down (H09AAPPLE-39)', () => {
  it('loads friction, insight, and cluster timings for managers', () => {
    expect(detailSource).toContain('getFrictionWorkflowList');
    expect(detailSource).toContain('getWorkflowInsightSummary');
    expect(detailSource).toContain('getWorkflowClusterTimings');
    expect(detailSource).toContain("user?.role !== 'MANAGER'");
  });

  it('renders the brief chart set with insight at the top', () => {
    expect(detailSource).toContain('<h2>Executive insight</h2>');
    expect(detailSource).toContain('<FrictionHeatmap');
    expect(detailSource).toContain('<PathComparisonChart');
    expect(detailSource).toContain('<BestVsAverageChart');
    expect(detailSource.indexOf('<h2>Executive insight</h2>')).toBeLessThan(
      detailSource.indexOf('<FrictionHeatmap'),
    );
  });

  it('keeps back navigation and omits employee identifiers', () => {
    expect(detailSource).toContain('href="/dashboard/variance"');
    expect(detailSource).not.toContain('employee_id');
    expect(detailSource).not.toContain('employee_email');
    expect(heatmapSource).not.toContain('employee_id');
    expect(pathSource).not.toContain('employee_id');
    expect(bestSource).not.toContain('employee_id');
  });

  it('highlights HIGH_VARIANCE in red and shows step instructions on hover', () => {
    expect(utilsSource).toContain('#EF4444');
    expect(heatmapSource).toContain('instruction');
    expect(pathSource).toContain('HIGH_VARIANCE');
    expect(bestSource).toContain('HIGH_VARIANCE');
  });

  it('lets managers generate path comparison from the detail page', () => {
    expect(detailSource).toContain('clusterWorkflowByName');
    expect(detailSource).toContain('Generate Path Comparison');
    expect(detailSource).toContain('Regenerate Path Comparison');
    expect(detailSource).toContain('Generating...');
    expect(detailSource).toContain('Retry');
    expect(detailSource).toContain('getWorkflowClusterTimings(workflowId)');
  });
});

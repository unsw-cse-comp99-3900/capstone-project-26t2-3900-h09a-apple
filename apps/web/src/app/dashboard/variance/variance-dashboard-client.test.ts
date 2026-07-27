import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(
  new URL('./variance-dashboard-client.tsx', import.meta.url),
  'utf-8',
);

describe('variance dashboard client', () => {
  it('loads published SOPs and cached analysis automatically', () => {
    expect(dashboardSource).toContain('getPublishedSops()');
    expect(dashboardSource).toContain('getKmeansAnalysis(workflowId)');
    expect(dashboardSource).toContain("user?.role !== 'MANAGER'");
  });

  it('runs a fresh analysis with manager-selected settings', () => {
    expect(dashboardSource).toContain('runKmeansAnalysis({');
    expect(dashboardSource).toContain('workflow_id: workflowId');
    expect(dashboardSource).toContain('min_sessions: minSessions');
  });

  it('prevents stale cached requests from replacing a fresh analysis', () => {
    expect(dashboardSource).toContain('const analysisRequestId = useRef(0)');
    expect(dashboardSource).toContain('requestId === analysisRequestId.current');
    expect(dashboardSource).toContain('loadingAnalysis ||');
  });

  it('renders result and empty-state sections', () => {
    expect(dashboardSource).toContain('Silhouette score');
    expect(dashboardSource).toContain('Characteristics');
    expect(dashboardSource).toContain('Assignments');
    expect(dashboardSource).toContain('Outliers');
    expect(dashboardSource).toContain('No cached analysis');
    expect(dashboardSource).toContain('{outlier.reason}');
  });
});

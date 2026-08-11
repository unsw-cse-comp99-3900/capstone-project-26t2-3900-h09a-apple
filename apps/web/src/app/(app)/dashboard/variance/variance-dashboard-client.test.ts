/**
 * Tests for the friction rankings list client.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(
  new URL('./variance-dashboard-client.tsx', import.meta.url),
  'utf-8',
);
const cardSource = readFileSync(new URL('./workflow-friction-card.tsx', import.meta.url), 'utf-8');
const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf-8');
const navSource = readFileSync(
  new URL('../../../../components/shell/nav-items.ts', import.meta.url),
  'utf-8',
);

describe('variance dashboard friction list (H09AAPPLE-38)', () => {
  it('server-renders the initial friction list payload', () => {
    expect(pageSource).toContain('loadFrictionWorkflowList');
    expect(pageSource).toContain('initialList={initialList}');
  });

  it('loads ranked workflows for managers and keeps clustering secondary', () => {
    expect(dashboardSource).toContain('getFrictionWorkflowList');
    expect(dashboardSource).toContain("user?.role !== 'MANAGER'");
    expect(dashboardSource).toContain('WorkflowFrictionCard');
    // Clustering stays a sibling Analytics route in the shell, not an in-page primary CTA.
    expect(dashboardSource).toContain('sidebar for clustering');
    expect(navSource).toContain('/dashboard/variance/clustering');
  });

  it('refreshes rankings when friction analysis updates arrive', () => {
    expect(dashboardSource).toContain('createFrictionWsTicket');
    expect(dashboardSource).toContain("update.event === 'friction_analysis.updated'");
    expect(dashboardSource).toContain('void refreshList()');
  });

  it('renders card fields required by the ticket without employee identifiers', () => {
    expect(cardSource).toContain('HIGH VARIANCE');
    expect(cardSource).toContain('FrictionBarChart');
    expect(cardSource).toContain('insight-teaser');
    expect(cardSource).toContain('`/dashboard/variance/${workflow.workflow_id}`');
    expect(cardSource).not.toContain('employee_id');
    expect(cardSource).not.toContain('employee_email');
    expect(dashboardSource).not.toContain('employee_id');
    expect(dashboardSource).not.toContain('employee_email');
  });
});

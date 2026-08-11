/**
 * Extra API client coverage for dashboard, consent, feedback, and WS helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acceptConsent,
  clusterWorkflowByName,
  createFrictionWsTicket,
  createNotificationWsTicket,
  createSession,
  deleteSop,
  frictionWebSocketUrl,
  getConsentStatus,
  getDashboardSummary,
  getFeedbackStats,
  getFrictionAnalysis,
  getFrictionWorkflowList,
  getHealth,
  getMyDrafts,
  getSessionStatus,
  getSopStepEdits,
  getVoiceFeedback,
  getWorkflowClusterTimings,
  getWorkflowInsightSummary,
  listFeedbackNotifications,
  listVoiceFeedback,
  markFeedbackNotificationRead,
  notificationsWebSocketUrl,
  patchSopStepInstruction,
  recalculateWorkflowFriction,
  retryGenerateSop,
  reviewVoiceFeedback,
} from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('session and health helpers', () => {
  it('loads health without the proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ status: 'ok' }));
    await expect(getHealth()).resolves.toEqual({ status: 'ok' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('creates a session and polls status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ session_id: 's1', job_id: 'j1' }))
      .mockResolvedValueOnce(ok({ session_id: 's1', job_status: 'pending', sop_id: null }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      createSession({
        client_session_id: '00000000-0000-0000-0000-000000000001',
        workflow_name: 'Demo',
        started_at: '2026-08-11T00:00:00Z',
        stopped_at: '2026-08-11T00:00:01Z',
        events: [],
        screenshots: [],
      }),
    ).resolves.toEqual({ session_id: 's1', job_id: 'j1' });
    await expect(getSessionStatus('s1')).resolves.toMatchObject({ session_id: 's1' });
    await expect(retryGenerateSop('s1')).resolves.toBeUndefined();
  });

  it('deletes a SOP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteSop('sop-1')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/backend/sops/sop-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('dashboard and workflow helpers', () => {
  it('loads dashboard summary and friction lists', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ role: 'MANAGER', greeting: 'Hi', kpis: [], primary_items: [] }))
      .mockResolvedValueOnce(ok({ workflows: [] }))
      .mockResolvedValueOnce(ok({ sop_id: 's', steps: [] }));

    await expect(getDashboardSummary()).resolves.toMatchObject({ role: 'MANAGER' });
    await expect(getFrictionWorkflowList()).resolves.toEqual({ workflows: [] });
    await expect(getFrictionAnalysis('s')).resolves.toEqual({ sop_id: 's', steps: [] });
  });

  it('loads insight, timings, recalculate, and cluster-by-name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ workflow_id: 'w1', summary: 'ok' }))
      .mockResolvedValueOnce(ok({ workflow_id: 'w1', clusters: [] }))
      .mockResolvedValueOnce(ok({ workflow_id: 'w1', status: 'ok' }))
      .mockResolvedValueOnce(ok({ workflow_name: 'Demo', clusters: [] }));

    await expect(getWorkflowInsightSummary('w1')).resolves.toMatchObject({ workflow_id: 'w1' });
    await expect(getWorkflowClusterTimings('w1')).resolves.toMatchObject({ workflow_id: 'w1' });
    await expect(recalculateWorkflowFriction('w1')).resolves.toMatchObject({ workflow_id: 'w1' });
    await expect(clusterWorkflowByName('Demo')).resolves.toMatchObject({ workflow_name: 'Demo' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/backend/workflows/Demo/cluster',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('builds websocket URLs and mints tickets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        ok({ ticket: 't1', expires_in_seconds: 60, ws_path: '/api/v1/analytics/friction/ws' }),
      )
      .mockResolvedValueOnce(
        ok({ ticket: 't2', expires_in_seconds: 60, ws_path: '/api/v1/notifications/ws' }),
      );

    await expect(createFrictionWsTicket()).resolves.toMatchObject({ ticket: 't1' });
    await expect(createNotificationWsTicket()).resolves.toMatchObject({ ticket: 't2' });
    expect(frictionWebSocketUrl('abc')).toContain('token=abc');
    expect(notificationsWebSocketUrl('xyz')).toContain('token=xyz');
  });
});

describe('drafts consent feedback helpers', () => {
  it('loads drafts and patches step instructions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ sops: [] }))
      .mockResolvedValueOnce(
        ok({
          sop_id: 's1',
          step_number: 1,
          instruction: 'Click go',
          edit_id: 'e1',
          edited_at: '2026-08-11T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(ok({ sop_id: 's1', edits: [] }));

    await expect(getMyDrafts()).resolves.toEqual({ sops: [] });
    await expect(patchSopStepInstruction('s1', 1, 'Click go')).resolves.toMatchObject({
      edit_id: 'e1',
    });
    await expect(getSopStepEdits('s1')).resolves.toEqual({ sop_id: 's1', edits: [] });
  });

  it('reads and accepts consent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ accepted: false, version: null, accepted_at: null }))
      .mockResolvedValueOnce(
        ok({ accepted: true, version: '2026-07-01', accepted_at: '2026-08-11T00:00:00Z' }),
      );

    await expect(getConsentStatus('walkthrough')).resolves.toMatchObject({ accepted: false });
    await expect(
      acceptConsent({ consent_type: 'walkthrough', version: '2026-07-01' }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it('lists and reviews voice feedback plus notifications', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(ok({ id: 'f1' }))
      .mockResolvedValueOnce(ok({ id: 'f1', status: 'reviewed' }))
      .mockResolvedValueOnce(ok({ total: 0 }))
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(listVoiceFeedback({ severity: 'high', sopId: 's1' })).resolves.toEqual({
      items: [],
    });
    await expect(getVoiceFeedback('f1')).resolves.toEqual({ id: 'f1' });
    await expect(
      reviewVoiceFeedback('f1', { status: 'reviewed', classification: 'bug' } as never),
    ).resolves.toMatchObject({ status: 'reviewed' });
    await expect(getFeedbackStats()).resolves.toEqual({ total: 0 });
    await expect(listFeedbackNotifications(true)).resolves.toEqual({ items: [] });
    await expect(markFeedbackNotificationRead('n1')).resolves.toBeUndefined();
  });
});

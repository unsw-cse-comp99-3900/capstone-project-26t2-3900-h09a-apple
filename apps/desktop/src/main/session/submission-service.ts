import { readFile } from 'node:fs/promises';
import { authenticatedFetch } from '../auth/auth-service';

export interface SubmissionResult {
  success: boolean;
  sessionId: string;
  jobId: string;
  sopId: string;
}

export interface RemoteSessionSubmission {
  sessionId: string;
  jobId: string;
}

interface CreateSessionResponse {
  session_id: string;
  job_id: string;
}

interface SessionStatusResponse {
  session_id: string;
  job_status: 'pending' | 'processing' | 'completed' | 'failed';
  sop_id: string | null;
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text();
  return body || response.statusText || 'Unknown server error';
}

export async function createRemoteSession(
  artifactPath: string,
): Promise<RemoteSessionSubmission> {
  // Read the completed session payload written by DesktopSessionStore.
  const content = await readFile(artifactPath, 'utf8');
  const payload = JSON.parse(content);
  const response = await authenticatedFetch('/api/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to submit session (${response.status}): ${await responseError(response)}`,
    );
  }

  const result = (await response.json()) as CreateSessionResponse;

  return {
    sessionId: result.session_id,
    jobId: result.job_id,
  };
}

export async function generateSopDraft(
  submission: RemoteSessionSubmission,
): Promise<SubmissionResult> {
  const generationResponse = await authenticatedFetch(
    `/api/v1/sessions/${encodeURIComponent(submission.sessionId)}/generate-sop`,
    { method: 'POST' },
  );

  // A 409 means a previous request completed but its response may have been
  // lost. The status request below resolves that case without generating a
  // duplicate SOP.
  if (!generationResponse.ok && generationResponse.status !== 409) {
    throw new Error(
      `Failed to generate SOP (${generationResponse.status}): ${await responseError(
        generationResponse,
      )}`,
    );
  }

  const statusResponse = await authenticatedFetch(
    `/api/v1/sessions/${encodeURIComponent(submission.sessionId)}`,
  );

  if (!statusResponse.ok) {
    throw new Error(
      `Failed to verify SOP generation (${statusResponse.status}): ${await responseError(
        statusResponse,
      )}`,
    );
  }

  const status = (await statusResponse.json()) as SessionStatusResponse;

  if (status.job_status !== 'completed' || !status.sop_id) {
    throw new Error(`SOP generation finished with status "${status.job_status}"`);
  }

  return {
    success: true,
    sessionId: submission.sessionId,
    jobId: submission.jobId,
    sopId: status.sop_id,
  };
}

import { readFile } from 'node:fs/promises';
import { authenticatedFetch } from '../auth/auth-service';

export interface SubmissionResult {
  success: boolean;
  sessionId?: string;
  jobId?: string;
}

interface SubmissionResponse {
  session_id: string;
  job_id: string;
}

export async function submitSession(artifactPath: string): Promise<SubmissionResult> {
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
    const message = await response.text();

    throw new Error(`Failed to submit session (${response.status}): ${message}`);
  }

  const result = (await response.json()) as SubmissionResponse;

  return {
    success: true,
    sessionId: result.session_id,
    jobId: result.job_id,
  };
}

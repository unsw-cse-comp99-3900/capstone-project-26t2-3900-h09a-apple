import { authenticatedFetch, getCurrentAuth } from '../auth/auth-service';
import {
  clearConsent,
  CONSENT_TERMS_VERSION,
  saveConsent,
} from './consent-store';

export const CONSENT_TYPE = 'recording';

export interface ConsentStatusResponse {
  accepted: boolean;
  accepted_at: string | null;
}

export interface ConsentAcceptResponse {
  accepted: boolean;
  accepted_at: string;
}

/**
 * Load the current user's consent status from the backend.
 */
export async function fetchConsentStatus(): Promise<ConsentStatusResponse> {
  const response = await authenticatedFetch(
    `/api/v1/consent/status?consent_type=${encodeURIComponent(
      CONSENT_TYPE,
    )}`,
  );

  if (!response.ok) {
    throw new Error('Failed to load consent status');
  }

  return (await response.json()) as ConsentStatusResponse;
}

/**
 * Record acceptance of the current consent terms.
 */
export async function postConsentAccept(): Promise<ConsentAcceptResponse> {
  const response = await authenticatedFetch('/api/v1/consent/accept', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      consent_type: CONSENT_TYPE,
      version: CONSENT_TERMS_VERSION,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to record consent');
  }

  return (await response.json()) as ConsentAcceptResponse;
}

/**
 * Synchronise the server consent state into the local desktop cache.
 */
export async function syncConsentFromServer() {
  const auth = getCurrentAuth();

  if (!auth) {
    return null;
  }

  const status = await fetchConsentStatus();

  if (status.accepted && status.accepted_at) {
    return saveConsent(auth.userId, status.accepted_at);
  }

  clearConsent(auth.userId);

  return null;
}
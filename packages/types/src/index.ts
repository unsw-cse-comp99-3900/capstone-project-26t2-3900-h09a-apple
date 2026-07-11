export type HealthResponse = {
  status: 'ok' | 'degraded' | 'down';
};

export * from './auth';
export * from './consent';
export * from './session';

export type HealthResponse = {
  status: 'ok' | 'degraded' | 'down';
};

export * from './analytics';
export * from './auth';
export * from './consent';
export * from './session';

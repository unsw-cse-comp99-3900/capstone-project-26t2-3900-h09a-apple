import { describe, expect, it } from 'vitest';
import { apiUrl } from './api';

describe('apiUrl', () => {
  it('joins the base URL with a path', () => {
    expect(apiUrl('/health')).toMatch(/\/health$/);
  });

  it('adds a leading slash if missing', () => {
    expect(apiUrl('health')).toBe(apiUrl('/health'));
  });
});

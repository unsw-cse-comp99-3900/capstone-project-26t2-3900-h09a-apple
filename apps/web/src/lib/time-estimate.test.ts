/**
 * Tests for human-readable duration formatting.
 */

import { describe, expect, it } from 'vitest';

import { formatTimeEstimate } from './time-estimate';

describe('formatTimeEstimate', () => {
  it('formats seconds under a minute', () => {
    expect(formatTimeEstimate(45)).toBe('45s');
  });

  it('formats whole minutes and mixed values', () => {
    expect(formatTimeEstimate(120)).toBe('2m');
    expect(formatTimeEstimate(125)).toBe('2m 5s');
  });
});

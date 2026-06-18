import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reviewClientSource = readFileSync(
  new URL('./session-review-client.tsx', import.meta.url),
  'utf-8',
);

describe('session review timeline support', () => {
  it('renders labels for captured click, navigation, and input events', () => {
    expect(reviewClientSource).toContain("click: 'Click'");
    expect(reviewClientSource).toContain("navigation: 'Navigation'");
    expect(reviewClientSource).toContain("input: 'Input'");
  });

  it('describes click, navigation, and input payloads in the timeline', () => {
    expect(reviewClientSource).toContain("event.type === 'navigation'");
    expect(reviewClientSource).toContain("event.type === 'click'");
    expect(reviewClientSource).toContain("event.type === 'input'");
    expect(reviewClientSource).toContain('Entered ${event.value');
  });

  it('does not fall back to mock session data when loading fails', () => {
    expect(reviewClientSource).not.toContain('MOCK_SESSION');
    expect(reviewClientSource).toContain('No captured session was found for this id.');
  });
});

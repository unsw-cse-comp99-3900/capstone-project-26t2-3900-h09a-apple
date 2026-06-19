import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reviewClientSource = readFileSync(
  new URL('./session-review-client.tsx', import.meta.url),
  'utf-8',
);

describe('session review timeline support', () => {
it('renders labels for all EventType values', () => {
expect(reviewClientSource).toContain("click: 'Click'");
expect(reviewClientSource).toContain("navigation: 'Navigation'");
expect(reviewClientSource).toContain("input: 'Input'");
expect(reviewClientSource).toContain("submit: 'Submit'");
expect(reviewClientSource).toContain("tab_switch: 'Tab switch'");
});
it('defines icons for all EventType values', () => {
expect(reviewClientSource).toContain('submit: (');
expect(reviewClientSource).toContain('tab_switch: (');
expect(reviewClientSource).toMatch(/const EVENT_ICONS: Record<EventType/);
expect(reviewClientSource).toMatch(/const EVENT_LABELS: Record<EventType/);
});
it('describes submit events in the timeline', () => {
expect(reviewClientSource).toContain("event.type === 'submit'");
expect(reviewClientSource).toContain('Submitted form');
});
it('handles tab_switch events in the timeline', () => {
// currently via default branch; prefer explicit event.type === 'tab_switch' later
expect(reviewClientSource).toContain('Switched browser tab');
});

});

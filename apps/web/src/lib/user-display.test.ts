/**
 * Tests for display-name and avatar initial helpers.
 */

import { describe, expect, it } from 'vitest';

import { avatarInitials, displayNameFromEmail } from './user-display';

describe('user display helpers', () => {
  it('formats email locals like the API display_name helper', () => {
    expect(displayNameFromEmail('week6-manager@example.com')).toBe('Week6 Manager');
    expect(displayNameFromEmail('ann.bee_wee@example.com')).toBe('Ann Bee Wee');
  });

  it('builds avatar initials from the first two name tokens', () => {
    expect(avatarInitials('Wek Man')).toBe('WM');
    expect(avatarInitials('Week6 Manager')).toBe('WM');
    expect(avatarInitials('week6-manager')).toBe('WM');
    expect(avatarInitials('ANN BEE WEE')).toBe('AB');
  });

  it('uses the first two letters for a single token', () => {
    expect(avatarInitials('Man')).toBe('MA');
    expect(avatarInitials('Wan')).toBe('WA');
  });
});

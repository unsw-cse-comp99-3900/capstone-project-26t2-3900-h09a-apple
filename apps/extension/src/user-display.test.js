import assert from 'node:assert/strict';
import test from 'node:test';

import { avatarInitials, displayNameFromEmail } from './user-display.js';

test('formats email locals like the web/API display_name helper', () => {
  assert.equal(displayNameFromEmail('week6-manager@example.com'), 'Week6 Manager');
  assert.equal(displayNameFromEmail('ann.bee_wee@example.com'), 'Ann Bee Wee');
});

test('builds avatar initials from the first two name tokens', () => {
  assert.equal(avatarInitials('Wek Man'), 'WM');
  assert.equal(avatarInitials('Week6 Manager'), 'WM');
  assert.equal(avatarInitials('week6-manager'), 'WM');
  assert.equal(avatarInitials('ANN BEE WEE'), 'AB');
});

test('uses the first two letters for a single token', () => {
  assert.equal(avatarInitials('Man'), 'MA');
  assert.equal(avatarInitials('Wan'), 'WA');
});

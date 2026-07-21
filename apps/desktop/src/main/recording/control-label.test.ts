import assert from 'node:assert/strict';
import test from 'node:test';

import { isAppOrWindowLabel, pickControlLabel } from './control-label';

test('pickControlLabel rejects app and window chrome names', () => {
  assert.equal(pickControlLabel('Claude', 'Claude', 'Claude'), null);
  assert.equal(pickControlLabel('Claude', 'Claude', 'Inbox'), null);
  assert.equal(pickControlLabel('Inbox', 'Claude', 'Inbox'), null);
  assert.equal(pickControlLabel('Create project', 'Claude', 'Claude'), 'Create project');
  assert.equal(pickControlLabel('  Projects  ', 'Claude', 'Claude'), 'Projects');
  assert.equal(pickControlLabel('highlighted control', 'Claude', 'Claude'), null);
  assert.equal(pickControlLabel('Button', 'Claude', 'Claude'), null);
});

test('isAppOrWindowLabel is case-insensitive', () => {
  assert.equal(isAppOrWindowLabel('claude', 'Claude', 'Claude'), true);
  assert.equal(isAppOrWindowLabel('Create project', 'Claude', 'Claude'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { readableAutomationId } from './uia-at-point';

test('readableAutomationId keeps short UI-like ids and rejects opaque ones', () => {
  assert.equal(readableAutomationId('Chat'), 'Chat');
  assert.equal(readableAutomationId('CreateProject'), 'Create Project');
  assert.equal(readableAutomationId('create_project'), 'create project');
  assert.equal(readableAutomationId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), null);
  assert.equal(readableAutomationId('12345'), null);
  assert.equal(readableAutomationId(''), null);
});

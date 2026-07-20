import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generalizePathname,
  isDynamicPathname,
  learnFromStepTransition,
  pathsAreSameResourceShape,
  resolvePlaybackTargetUrl,
  resolvedUrlKey,
} from './walkthrough-url-resolve.js';

test('generalizePathname replaces numeric and uuid segments', () => {
  assert.equal(generalizePathname('/org/repo/issues/65'), '/org/repo/issues/{id}');
  assert.equal(generalizePathname('/items/550e8400-e29b-41d4-a716-446655440000'), '/items/{id}');
  assert.equal(generalizePathname('/issues/new'), '/issues/new');
});

test('pathsAreSameResourceShape allows new/create to become an id', () => {
  assert.equal(pathsAreSameResourceShape('/org/repo/issues/new', '/org/repo/issues/70'), true);
  assert.equal(pathsAreSameResourceShape('/org/repo/issues/65', '/org/repo/issues/70'), true);
  assert.equal(pathsAreSameResourceShape('/org/repo/issues/new', '/org/repo/pulls/1'), false);
});

test('learnFromStepTransition captures create -> live issue URL', () => {
  const learned = learnFromStepTransition(
    {},
    'https://github.com/acme/app/issues/new',
    'https://github.com/acme/app/issues/70',
  );

  const key = resolvedUrlKey('https://github.com', '/acme/app/issues/70');
  assert.equal(learned[key], 'https://github.com/acme/app/issues/70');
  assert.equal(isDynamicPathname('/acme/app/issues/70'), true);
});

test('resolvePlaybackTargetUrl prefers learned live URL over stale recording', () => {
  const key = resolvedUrlKey('https://github.com', '/acme/app/issues/65');
  const resolved = resolvePlaybackTargetUrl(
    'https://github.com/acme/app/issues/65',
    { [key]: 'https://github.com/acme/app/issues/70' },
    'https://github.com/acme/app/issues/70',
  );

  assert.equal(resolved.mode, 'resolved');
  assert.equal(resolved.url, 'https://github.com/acme/app/issues/70');
});

test('resolvePlaybackTargetUrl does not navigate to unresolved dynamic URLs', () => {
  const resolved = resolvePlaybackTargetUrl(
    'https://github.com/acme/app/issues/65',
    {},
    'https://github.com/acme/app/issues/new',
  );

  assert.equal(resolved.mode, 'unresolved_dynamic');
  assert.equal(resolved.url, null);
});

test('resolvePlaybackTargetUrl keeps static recorded URLs', () => {
  const resolved = resolvePlaybackTargetUrl(
    'https://example.com/settings',
    {},
    'https://example.com/app',
  );

  assert.equal(resolved.mode, 'recorded');
  assert.equal(resolved.url, 'https://example.com/settings');
});

test('resolvePlaybackTargetUrl uses live page when it already matches the template', () => {
  const resolved = resolvePlaybackTargetUrl(
    'https://github.com/acme/app/issues/65',
    {},
    'https://github.com/acme/app/issues/70?tab=comments',
  );

  assert.equal(resolved.mode, 'live');
  assert.equal(resolved.url, 'https://github.com/acme/app/issues/70?tab=comments');
});

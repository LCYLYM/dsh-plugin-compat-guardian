import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationEvent, notificationMarker, sendConfiguredAdapters } from '../lib/notifier.js';

test('notification IDs are stable per repository, target, epoch, and state', () => {
  const report = { status: 'PASS', candidate: { version: '1.2.3' }, campaign: { epoch: 2 } };
  assert.equal(notificationEvent(report).id, notificationEvent(report).id);
  assert.notEqual(notificationEvent(report).id, notificationEvent(report, 'BLOCKED').id);
  assert.equal(notificationMarker(notificationEvent(report), 'telegram'), `<!-- dsh-guardian-event:${notificationEvent(report).id}:telegram -->`);
});

test('disabled adapters make no network request', async () => {
  assert.deepEqual(await sendConfiguredAdapters({ status: 'PASS' }, {
    notifications: { email: false, telegram: false, webhook: false },
  }, {}), []);
});

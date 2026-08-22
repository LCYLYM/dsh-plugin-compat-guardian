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

test('enabled adapters send only the sanitized event to their configured endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true };
  };
  const event = { id: 'stable-event', status: 'PASS', target: '0.1.1-rc.2', runUrl: 'https://example.test/run/1', error: null };
  try {
    assert.deepEqual(await sendConfiguredAdapters(event, {
      notifications: { email: true, telegram: true, webhook: true },
    }, {
      GUARDIAN_EMAIL_GATEWAY_URL: 'https://email.example.test/events',
      GUARDIAN_TELEGRAM_BOT_TOKEN: 'test-token',
      GUARDIAN_TELEGRAM_CHAT_ID: '12345',
      GUARDIAN_WEBHOOK_URL: 'https://webhook.example.test/events',
    }), ['email', 'telegram', 'webhook']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map(item => item.url), [
    'https://email.example.test/events',
    'https://api.telegram.org/bottest-token/sendMessage',
    'https://webhook.example.test/events',
  ]);
  assert.deepEqual(requests[0].body, { channel: 'email', event });
  assert.equal(requests[1].body.chat_id, '12345');
  assert.match(requests[1].body.text, /DSH Guardian：兼容验证通过/);
  assert.match(requests[1].body.text, /目标 DSH：0\.1\.1-rc\.2/);
  assert.deepEqual(requests[2].body, event);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { objectHash, stableStringify } from '../lib/hash.js';
import { redactText } from '../lib/process.js';
import { trackedTreeDigest } from '../lib/verifier.js';

test('stableStringify and objectHash ignore object key insertion order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(objectHash(left), objectHash(right));
});

test('redactor removes explicit secrets and common credential fields', () => {
  const secret = 'explicit-real-secret-value';
  const keyLike = ['sk', 'json-secret-value'].join('-');
  const redacted = redactText(
    `value=${secret}\nAuthorization: Bearer abc123\napi_key=another-secret\n{"api_key":"${keyLike}","token":"json-token"}\nhttps://example.test/?key=query-secret`,
    [secret],
  );
  for (const forbidden of [secret, 'abc123', 'another-secret', keyLike, 'json-token', 'query-secret']) {
    assert.ok(!redacted.includes(forbidden));
  }
  assert.match(redacted, /\[REDACTED\]/);
});

test('tracked source digest ignores the machine lock but not plugin source', () => {
  const before = [
    '100644 aaa 0\tlib/index.js',
    '100644 old 0\t.dsh-compat.lock.json',
  ].join('\0');
  const lockOnly = [
    '100644 aaa 0\tlib/index.js',
    '100644 new 0\t.dsh-compat.lock.json',
  ].join('\0');
  const sourceChange = [
    '100644 bbb 0\tlib/index.js',
    '100644 new 0\t.dsh-compat.lock.json',
  ].join('\0');
  assert.equal(
    trackedTreeDigest(before, ['.dsh-compat.lock.json']),
    trackedTreeDigest(lockOnly, ['.dsh-compat.lock.json']),
  );
  assert.notEqual(
    trackedTreeDigest(before, ['.dsh-compat.lock.json']),
    trackedTreeDigest(sourceChange, ['.dsh-compat.lock.json']),
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { objectHash, stableStringify } from '../lib/hash.js';
import { redactText, runCommand, startService } from '../lib/process.js';
import { runtimeSnapshotIdentity, trackedTreeDigest } from '../lib/verifier.js';

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

test('command result marks bounded stdout and stderr instead of silently accepting truncation', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(32)); process.stderr.write("y".repeat(32))'], {
    outputLimit: 8,
  });
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.match(result.stdout, /output truncated/);
  assert.match(result.stderr, /output truncated/);
});

test('service keeps one-time protocol output transient while snapshots stay redacted', async () => {
  let announce;
  const announced = new Promise(resolve => { announce = resolve; });
  const service = startService(process.execPath, [
    '-e',
    'console.log("dsh web: http://127.0.0.1:1234/?token=one-time-token"); setInterval(() => {}, 1000)',
  ], { onStdout: announce });
  try {
    await announced;
    assert.match(service.protocolStdout(), /token=one-time-token/u);
    assert.doesNotMatch(service.snapshot().stdout, /one-time-token/u);
    assert.match(service.snapshot().stdout, /token=\[REDACTED\]/u);
  } finally {
    await service.stop();
  }
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

test('snapshot runtime ignores ephemeral runner names but keeps stable platform facts', () => {
  const runtime = {
    node: { exactVersion: '24.19.0' },
    packageManager: { name: 'npm', exactVersion: '11.17.0' },
    runner: {
      configuredLabel: 'ubuntu-24.04',
      actualLabel: 'GitHub Actions 1000000881',
      os: 'Linux',
      arch: 'x64',
      githubActions: true,
    },
  };
  const first = runtimeSnapshotIdentity(runtime);
  const second = runtimeSnapshotIdentity({
    ...runtime,
    runner: { ...runtime.runner, actualLabel: 'GitHub Actions 1000000883' },
  });
  assert.deepEqual(first, second);
  assert.equal(first.runner.actualLabel, undefined);
  assert.notDeepEqual(first, runtimeSnapshotIdentity({
    ...runtime,
    runner: { ...runtime.runner, os: 'Windows' },
  }));
});

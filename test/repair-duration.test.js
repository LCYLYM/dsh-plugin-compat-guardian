import assert from 'node:assert/strict';
import test from 'node:test';

import { independentVerifierEvidence } from '../lib/repair.js';

test('repair evidence reports the independent verifier duration', () => {
  const evidence = independentVerifierEvidence({
    status: 'PASS',
    steps: [
      { name: 'install-candidate-dsh', durationMs: 5353 },
      { name: 'repository-gate-1', durationMs: 1101 },
      { name: 'plugin-specific-smoke', durationMs: 3 },
      { name: 'missing-duration' },
    ],
  }, 1);

  assert.deepEqual(evidence, {
    name: 'independent-verifier-attempt-1',
    ok: true,
    durationMs: 6457,
    errorCode: undefined,
  });
});

test('repair evidence keeps a failed verifier code and ignores invalid durations', () => {
  const evidence = independentVerifierEvidence({
    status: 'BLOCKED',
    error: { code: 'COMMAND_FAILED' },
    steps: [{ durationMs: Number.NaN }, { durationMs: -1 }, { durationMs: 250 }],
  }, 2);

  assert.equal(evidence.name, 'independent-verifier-attempt-2');
  assert.equal(evidence.ok, false);
  assert.equal(evidence.durationMs, 250);
  assert.equal(evidence.errorCode, 'COMMAND_FAILED');
});

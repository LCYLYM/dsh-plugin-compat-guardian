import assert from 'node:assert/strict';
import test from 'node:test';

import { CommandError } from '../lib/errors.js';
import { classifyRepairFailure, independentVerifierEvidence, sanitizedDiagnostic } from '../lib/repair.js';

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

test('a verifier command mentioning 401 is not misreported as a model credential failure', () => {
  const error = new CommandError({
    displayCommand: 'npm test',
    exitCode: 1,
    stdout: 'fixture expected HTTP 401 but received a different response',
    stderr: '',
    durationMs: 123,
  });

  const verifierFailure = classifyRepairFailure(error, 'independent-verifier');
  assert.equal(verifierFailure.code, 'REPAIR_VERIFIER_COMMAND_FAILED');
  assert.equal(verifierFailure.status, 'BLOCKED');

  const modelFailure = classifyRepairFailure(error, 'model-call');
  assert.equal(modelFailure.code, 'MODEL_CREDENTIAL_REJECTED');
  assert.equal(modelFailure.status, 'BLOCKED_CONFIG');
});

test('repair diff timeout has a durable, actionable failure code', () => {
  const error = new CommandError({
    displayCommand: 'git diff --cached --binary',
    exitCode: null,
    timedOut: true,
    timeoutMs: 30_000,
    stdout: '',
    stderr: '',
    durationMs: 30_001,
  });
  const failure = classifyRepairFailure(error, 'repair-diff');
  assert.equal(failure.code, 'REPAIR_DIFF_TIMEOUT');
  assert.equal(failure.status, 'BLOCKED');
  assert.match(failure.message, /不会发布残缺补丁/);
});

test('failed command diagnostic is short, redacted, and removes runner paths', () => {
  const diagnostic = sanitizedDiagnostic({
    exitCode: 1,
    timedOut: false,
    stderr: 'Error at /home/runner/work/repo/repo/file.js api_key=super-secret-value',
  });
  assert.match(diagnostic, /<PATH>/);
  assert.match(diagnostic, /\[REDACTED\]/);
  assert.doesNotMatch(diagnostic, /super-secret-value|\/home\/runner/);
});

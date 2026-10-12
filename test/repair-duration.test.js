import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { CommandError } from '../lib/errors.js';
import {
  classifyRepairFailure,
  consumedRepairAttempts,
  independentVerifierEvidence,
  sanitizedDiagnostic,
  successfulModelAttempts,
  verifierRefinementDecision,
} from '../lib/repair.js';

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
    diagnostic: undefined,
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
  assert.equal(evidence.diagnostic, undefined);
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

test('external verifier failure stops without another paid refinement', () => {
  assert.deepEqual(verifierRefinementDecision({
    status: 'BLOCKED',
    error: { code: 'GITHUB_RELEASE_UNAVAILABLE' },
  }), { refine: false, code: 'GITHUB_RELEASE_UNAVAILABLE', status: 'BLOCKED_EXTERNAL' });
});

test('a real plugin smoke failure remains eligible for one refinement', () => {
  assert.deepEqual(verifierRefinementDecision({
    status: 'BLOCKED',
    error: { code: 'SMOKE_ASSERTION_FAILED' },
  }), { refine: true, code: 'SMOKE_ASSERTION_FAILED', status: 'BLOCKED' });
});

test('a web crash without actionable diagnostics does not spend a blind refinement', () => {
  assert.deepEqual(verifierRefinementDecision({
    status: 'BLOCKED',
    error: { code: 'WEB_EXITED', message: 'dsh web exited' },
  }), { refine: false, code: 'WEB_EXITED', status: 'BLOCKED' });
});

test('a web crash with sanitized diagnostics remains eligible for targeted refinement', () => {
  assert.deepEqual(verifierRefinementDecision({
    status: 'BLOCKED',
    error: { code: 'WEB_EXITED', diagnostic: 'missing export resolveSessionPreset' },
  }), { refine: true, code: 'WEB_EXITED', status: 'BLOCKED' });
});

test('successful model call evidence excludes failed calls', () => {
  assert.equal(successfulModelAttempts([
    { name: 'install-repair-dsh', ok: true },
    { name: 'run-repair-dsh', ok: true },
    { name: 'independent-verifier-attempt-1', ok: false },
    { name: 'run-repair-refinement', ok: false },
  ]), 1);
  assert.equal(successfulModelAttempts([{ name: 'run-repair-dsh', ok: false }]), 0);
});

test('a successful first call cannot hide a started failed refinement from the repair limit', () => {
  const steps = [
    { name: 'run-repair-dsh', ok: true },
    { name: 'independent-verifier-attempt-1', ok: false },
    { name: 'run-repair-refinement', ok: false },
  ];
  for (const status of ['BLOCKED', 'BLOCKED_CONTRACT']) {
    assert.equal(consumedRepairAttempts(steps, { status, modelAttempted: true, modelAttempts: 2 }), 2);
  }
  assert.equal(consumedRepairAttempts([], { status: 'BLOCKED', modelAttempted: false, modelAttempts: 0 }), 0);
  assert.equal(consumedRepairAttempts([{ name: 'run-repair-dsh', ok: false }],
    { status: 'BLOCKED', modelAttempted: true, modelAttempts: 1 }), 1);
  // Config/external recovery behavior is unchanged by the repair-failure fix.
  assert.equal(consumedRepairAttempts(steps,
    { status: 'BLOCKED_EXTERNAL', modelAttempted: true, modelAttempts: 2 }), 1);
});

test('verbose failed-model diagnostics retain the redacted terminal error within the same cap', () => {
  const diagnostic = sanitizedDiagnostic({ exitCode: 1, timedOut: false,
    stderr: 'dsh: reasoning: ' + 'planning '.repeat(100) +
      'terminal error at /home/runner/work/private/repo/model.js api_key=super-secret-value',
  });
  assert.ok(diagnostic.length <= 500);
  assert.match(diagnostic, /dsh: reasoning:.*middle omitted.*terminal error/);
  assert.match(diagnostic, /<PATH>.*\[REDACTED\]/);
  assert.doesNotMatch(diagnostic, /super-secret-value|\/home\/runner/);
});

test('convergence is coalesced with verifier refinement without deleting historical model turns', async () => {
  const source = await readFile(new URL('../lib/repair.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /await runModel\(convergePrompt/);
  assert.match(source, /previous\?\.attempts_used \?\? 0\) \+ modelAttempts >= config\.repair\.max_attempts/);
  assert.equal(successfulModelAttempts([
    { name: 'run-repair-dsh', ok: true }, { name: 'send-converge-message', ok: true },
  ]), 2);
});

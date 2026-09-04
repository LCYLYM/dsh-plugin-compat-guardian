import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizedVerifierDiagnostic } from '../lib/verifier.js';

test('service diagnostics keep the actionable crash and remove secrets and private paths', () => {
  const credential = `sk-${'x'.repeat(24)}`;
  const diagnostic = sanitizedVerifierDiagnostic({
    stderr: 'Error at /private/var/folders/demo/plugin.js: api_key=super-secret-value; missing export resolveSessionPreset',
    stdout: `launch token=${credential}`,
  });

  assert.match(diagnostic, /missing export resolveSessionPreset/);
  assert.match(diagnostic, /<PATH>/);
  assert.match(diagnostic, /\[REDACTED\]/);
  assert.doesNotMatch(diagnostic, new RegExp(`super-secret-value|${credential}|/private/var/folders`));
  assert.ok(diagnostic.length <= 1_000);
});

test('service diagnostics are absent when the process produced no useful output', () => {
  assert.equal(sanitizedVerifierDiagnostic({ stderr: '', stdout: '' }), undefined);
  assert.equal(sanitizedVerifierDiagnostic(undefined), undefined);
});

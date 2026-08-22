import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePackResult } from '../lib/verifier.js';

test('npm pack parser ignores scoped-package lifecycle logs before JSON', async () => {
  const stdout = [
    'ℹ [@scope/plugin] Build start',
    '✔ [@scope/plugin] Build complete',
    '[',
    '  {"filename":"scope-plugin-1.0.0.tgz"}',
    ']',
  ].join('\n');
  const packed = await parsePackResult(stdout, '/tmp/guardian-pack');
  assert.equal(packed, '/tmp/guardian-pack/scope-plugin-1.0.0.tgz');
});

test('npm pack parser reports a stable Guardian error for invalid output', async () => {
  await assert.rejects(
    parsePackResult('ℹ [@scope/plugin] Build complete', '/tmp/guardian-pack'),
    error => error.code === 'PACK_INVALID',
  );
});

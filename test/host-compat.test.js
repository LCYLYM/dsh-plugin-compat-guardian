import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDeclaredHostCompatibility } from '../lib/verifier.js';

test('declared DSH host bounds accept the reviewed version', () => {
  assert.doesNotThrow(() => assertDeclaredHostCompatibility({
    dsh: { compat: { minHost: '0.1.0-rc.8', maxHost: '0.1.1-rc.1' } },
  }, '0.1.1-rc.1'));
});

test('declared DSH maxHost blocks a newer candidate with a repairable code', () => {
  assert.throws(() => assertDeclaredHostCompatibility({
    dsh: { compat: { maxHost: '0.1.1-rc.1' } },
  }, '0.1.1-rc.2'), error => error.code === 'HOST_VERSION_UNSUPPORTED');
});

test('declared DSH host bounds reject malformed versions', () => {
  assert.throws(() => assertDeclaredHostCompatibility({
    dsh: { compat: { minHost: 'latest' } },
  }, '0.1.1-rc.2'), error => error.code === 'HOST_COMPAT_INVALID');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyManifestChanges, diffStatistics } from '../lib/diff-policy.js';

test('ordinary DSH range changes can use configured delivery', () => {
  assert.deepEqual(classifyManifestChanges(
    { dependencies: { '@deepseek-ai/dsh': '^1.2.0' } },
    { dependencies: { '@deepseek-ai/dsh': '^1.3.0' } },
  ), { forceReview: [], reject: [] });
});

test('unrelated dependency upgrades reject while dangerous manifest changes force review', () => {
  const unrelated = classifyManifestChanges({ dependencies: { lodash: '^4.0.0' } }, { dependencies: { lodash: '^4.1.0' } });
  assert.match(unrelated.reject[0], /unrelated dependency/);
  const risky = classifyManifestChanges(
    { dependencies: { '@deepseek-ai/dsh': '^1.0.0' }, scripts: { test: 'node test.js' } },
    { dependencies: { '@deepseek-ai/dsh': '^2.0.0', '@deepseek-ai/new': '^1.0.0' }, scripts: { test: 'node changed.js', postinstall: 'node install.js' } },
  );
  assert.equal(risky.reject.length, 0);
  assert.equal(risky.forceReview.length, 4);
});

test('diff statistics report size without imposing a line threshold', () => {
  assert.deepEqual(diffStatistics('10\t2\tlib/a.js\n-\t-\tfixture.png\n'), {
    files: 2, additions: 10, deletions: 2, binaryFiles: 1,
  });
});

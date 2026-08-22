import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { classifyManifestChanges, classifyRepairDiff, diffStatistics } from '../lib/diff-policy.js';

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

test('repair diff policy reads the configured monorepo plugin manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-diff-workspace-'));
  const workspace = join(root, 'packages', 'plugin');
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"private":true}\n');
    await writeFile(join(workspace, 'package.json'), '{"name":"plugin","dependencies":{"@deepseek-ai/dsh":"^1.0.0"}}\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Guardian Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'guardian@example.invalid'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    await writeFile(join(workspace, 'package.json'), '{"name":"plugin","dependencies":{"@deepseek-ai/dsh":"^1.1.0"}}\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    const result = await classifyRepairDiff(root, ['packages/plugin/package.json'], '1\t1\tpackages/plugin/package.json\n', {
      plugin: { workspace: 'packages/plugin', package_json: 'package.json' },
    });
    assert.equal(result.disposition, 'configured');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

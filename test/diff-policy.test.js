import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { classifyManifestChanges, classifyRepairDiff, diffStatistics } from '../lib/diff-policy.js';
import { assertRepairPaths, collectRepairPaths } from '../lib/repair.js';
import { DEFAULT_CONFIG } from '../lib/config.js';

test('repair path guard rejects generated package-manager caches', () => {
  assert.throws(
    () => assertRepairPaths(['.pnpm-store/v10/files/aa/cache-entry'], DEFAULT_CONFIG.repair.protected_paths),
    error => error?.code === 'PROTECTED_PATH_CHANGED',
  );
  assert.throws(
    () => assertRepairPaths(['.yarn/cache/pkg-npm-1.0.0.zip'], DEFAULT_CONFIG.repair.protected_paths),
    error => error?.code === 'PROTECTED_PATH_CHANGED',
  );
});

test('repair path scan sees generated caches before git add', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-prestage-scan-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Guardian Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'guardian@example.invalid'], { cwd: root });
    await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
    execFileSync('git', ['add', 'package.json'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    await mkdir(join(root, '.pnpm-store', 'v10'), { recursive: true });
    await writeFile(join(root, '.pnpm-store', 'v10', 'cache-entry'), 'generated');
    const paths = await collectRepairPaths(root);
    assert.deepEqual(paths, ['.pnpm-store/v10/cache-entry']);
    assert.throws(() => assertRepairPaths(paths, []), { code: 'PROTECTED_PATH_CHANGED' });
    assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

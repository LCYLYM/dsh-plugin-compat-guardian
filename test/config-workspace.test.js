import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG, resolvePluginPaths } from '../lib/config.js';

test('plugin workspace resolves a monorepo package without changing the repository root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-workspace-'));
  try {
    const workspace = join(root, 'packages', 'demo-plugin');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'package.json'), '{"name":"demo-plugin"}\n');
    const config = structuredClone(DEFAULT_CONFIG);
    config.plugin.workspace = 'packages/demo-plugin';
    const paths = await resolvePluginPaths(root, config);
    assert.equal(paths.root, await realpath(root));
    assert.equal(paths.workspace, await realpath(workspace));
    assert.equal(paths.workspaceRelative, 'packages/demo-plugin');
    assert.equal(paths.packageJson, await realpath(join(workspace, 'package.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plugin workspace rejects a symlink that escapes the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-workspace-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'guardian-workspace-outside-'));
  try {
    await writeFile(join(outside, 'package.json'), '{"name":"outside"}\n');
    await symlink(outside, join(root, 'plugin'));
    const config = structuredClone(DEFAULT_CONFIG);
    config.plugin.workspace = 'plugin';
    await assert.rejects(() => resolvePluginPaths(root, config), { code: 'PLUGIN_WORKSPACE_ESCAPE' });
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

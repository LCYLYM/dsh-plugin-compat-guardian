import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stringify } from 'yaml';

import { DEFAULT_CONFIG, loadConfig, resolvePluginPaths } from '../lib/config.js';

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

const INVALID_CONFIGS = [
  ['invalid watch source', { watch: { source: 'git-tags' } }],
  ['invalid GitHub repository', { watch: { github_repository: 'deepseek-ai' } }],
  ['empty provider', { repair: { provider: '' } }],
  ['numeric model', { repair: { model: 123 } }],
  ['invalid model output cap', { repair: { max_output_tokens: 0 } }],
  ['relative base URL', { credentials: { base_url: '/v1' } }],
  ['non-http base URL', { credentials: { base_url: 'file:///tmp/api' } }],
  ['numeric base URL', { credentials: { base_url: 42 } }],
  ['invalid API key env', { credentials: { api_key_env: 'BAD-NAME' } }],
  ['removed base URL env indirection', { credentials: { base_url_env: 'DEEPSEEK_BASE_URL' } }],
  ['invalid search URL', { credentials: { search_base_url: 'not-a-url' } }],
  ['invalid repair start policy', { repair: { start_policy: 'sometimes' } }],
];

test('default watch source is the official GitHub Release with prereleases enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-default-watch-'));
  try {
    const { config } = await loadConfig(root);
    assert.equal(config.watch.source, 'github-release');
    assert.equal(config.watch.github_repository, 'deepseek-ai/deepseek-harness');
    assert.equal(config.watch.github_include_prereleases, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, override] of INVALID_CONFIGS) {
  test(`config rejects ${name} before DSH starts`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'guardian-invalid-config-'));
    try {
      await writeFile(join(root, '.dsh-compat.yml'), stringify({ schema: 1, ...override }));
      await assert.rejects(() => loadConfig(root), { code: 'CONFIG_INVALID' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

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

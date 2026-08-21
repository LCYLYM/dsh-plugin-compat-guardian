import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { stringify } from 'yaml';

import { DEFAULT_CONFIG } from './config.js';
import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function discoverHealthAssertion(repoPath, manifest) {
  const candidates = [];
  const main = typeof manifest.main === 'string' ? manifest.main : undefined;
  if (main) candidates.push(resolve(repoPath, main));
  const lib = resolve(repoPath, 'lib');
  try {
    for (const file of await readdir(lib)) if (file.endsWith('.js')) candidates.push(resolve(lib, file));
  } catch {
    // Repositories do not have to use lib/.
  }
  for (const file of [...new Set(candidates)]) {
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const root = /(?:const|let|var)\s+API_ROOT\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1];
    const hasHealth = /suffix\s*===\s*['"]\/health['"]/.test(source);
    if (!root || !hasHealth) continue;
    const exportedName = /export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? manifest.name;
    return {
      id: 'plugin-health',
      method: 'GET',
      path: `${root}/health`,
      status: 200,
      json_subset: { ok: true, plugin: exportedName },
    };
  }
  return undefined;
}

function parseGuardianRef(guardianRef) {
  const match = /^([^\s@]+\/[^\s@]+)\/(\.github\/workflows\/[^\s@]+)@([0-9a-f]{40})$/.exec(guardianRef ?? '');
  if (!match) {
    throw new GuardianError('GUARDIAN_REF_REQUIRED', '--guardian-ref must name .github/workflows/<file> at a full 40-character commit SHA');
  }
  return { repository: match[1], workflowPath: match[2], ref: match[3] };
}

function workflowTemplate(guardianRef, defaultBranch = 'main') {
  const { repository, ref } = parseGuardianRef(guardianRef);
  return `name: DSH compatibility guardian

on:
  schedule:
    - cron: '17 */6 * * *'
  workflow_dispatch:
  push:
    branches: [${JSON.stringify(defaultBranch)}]
    paths:
      - .dsh-compat.yml
      - .dsh-compat.lock.json
      - compatibility/dsh-smoke.yml

permissions:
  contents: read

jobs:
  guardian:
    # Guardian release pin: replace only during an explicit Guardian upgrade.
    uses: ${guardianRef}
    permissions:
      contents: write
      pull-requests: write
      issues: write
    with:
      guardian_repository: ${repository}
      guardian_ref: ${ref}
      runner: ubuntu-24.04
`;
}

export async function scaffoldRepository(repoPath, options = {}) {
  const root = resolve(repoPath);
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const assertion = await discoverHealthAssertion(root, manifest);
  if (!assertion) {
    throw new GuardianError(
      'ONBOARDING_NEEDS_REVIEW',
      'could not deterministically discover a real plugin health assertion; add one through reviewed onboarding hints/model discovery',
    );
  }
  const config = structuredClone(DEFAULT_CONFIG);
  config.gates.repository = manifest.scripts?.test ? ['npm test', 'npm pack --dry-run'] : ['npm pack --dry-run'];
  const contract = {
    schema: 1,
    requires_model_turn: false,
    model_turn_scope: 'candidate-only',
    fixture_mode: 'fixed',
    web: {
      ready: { path: '/', timeout_seconds: 120 },
      assertions: [assertion],
    },
  };
  const lock = { schema: 1, resetBudget: 'N', verified: null, campaigns: {} };
  const files = new Map([
    ['.dsh-compat.yml', stringify(config, { lineWidth: 100 })],
    ['.dsh-compat.lock.json', `${JSON.stringify(lock, null, 2)}\n`],
    ['compatibility/dsh-smoke.yml', stringify(contract, { lineWidth: 100 })],
  ]);
  if (!options.noWorkflow) {
    parseGuardianRef(options.guardianRef);
    files.set('.github/workflows/dsh-compat.yml', workflowTemplate(options.guardianRef, options.defaultBranch));
  }
  for (const [relative, content] of files) {
    const target = resolve(root, relative);
    if (await exists(target)) throw new GuardianError('ONBOARDING_EXISTS', `${relative} already exists`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { files: [...files.keys()], assertion };
}

export async function onboardRepository(options = {}) {
  const repoPath = resolve(options.repoPath ?? '.');
  const status = await runCommand('git', ['status', '--porcelain'], { cwd: repoPath, timeoutMs: 30_000 });
  if (status.stdout.trim() !== '') throw new GuardianError('DIRTY_SOURCE', 'onboarding requires a clean repository');
  const baseBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
  if (!baseBranch) throw new GuardianError('DETACHED_HEAD', 'onboarding requires a named base branch');
  const branch = options.branch ?? 'automation/dsh-compat/onboarding';
  const existing = await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoPath,
    timeoutMs: 30_000,
    reject: false,
  });
  if (existing.exitCode === 0) throw new GuardianError('BRANCH_EXISTS', `local branch ${branch} already exists`);
  const worktree = await mkdtemp(join(tmpdir(), 'dsh-guardian-onboard-'));
  await runCommand('git', ['worktree', 'add', '-b', branch, worktree, 'HEAD'], { cwd: repoPath, timeoutMs: 60_000 });
  try {
    const generated = await scaffoldRepository(worktree, { ...options, defaultBranch: baseBranch });
    await runCommand('git', ['add', '--', ...generated.files], { cwd: worktree, timeoutMs: 30_000 });
    await runCommand('git', ['commit', '-m', 'ci: onboard DSH compatibility guardian'], { cwd: worktree, timeoutMs: 60_000 });
    let pullRequestUrl = null;
    if (!options.noPr) {
      const gh = await runCommand('gh', ['auth', 'status'], { cwd: worktree, timeoutMs: 30_000, reject: false });
      if (gh.exitCode === 0) {
        await runCommand('git', ['push', '--set-upstream', 'origin', branch], { cwd: worktree, timeoutMs: 2 * 60_000 });
        const created = await runCommand('gh', [
          'pr', 'create', '--base', baseBranch, '--head', branch,
          '--title', 'ci: onboard DSH compatibility guardian',
          '--body', 'Adds the reviewed compatibility contract, machine lock, configuration, and a full-SHA-pinned Guardian workflow. Auto-merge and direct-push remain disabled.',
        ], { cwd: worktree, timeoutMs: 2 * 60_000 });
        pullRequestUrl = created.stdout.trim();
      }
    }
    return {
      baseBranch,
      branch,
      pullRequestUrl,
      manualCommands: pullRequestUrl ? [] : [
        `git push --set-upstream origin ${branch}`,
        `gh pr create --base ${baseBranch} --head ${branch}`,
      ],
      ...generated,
    };
  } finally {
    await runCommand('git', ['worktree', 'remove', '--force', worktree], { cwd: repoPath, timeoutMs: 60_000, reject: false });
  }
}

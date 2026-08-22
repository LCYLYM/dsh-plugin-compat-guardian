import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { stringify } from 'yaml';

import { DEFAULT_CONFIG, validateContract } from './config.js';
import { dshRouteEnvironment, dshRouteRows } from './dsh-route.js';
import { GuardianError } from './errors.js';
import { runCommand } from './process.js';
import { resolvePackageManager } from './runtime.js';

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

async function discoverContractWithDsh(repoPath, config, hints) {
  const key = process.env[config.credentials.api_key_env] ?? process.env.DEEPSEEK_API_KEY;
  if (!key) return undefined;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'guardian-onboard-discovery-'));
  try {
    const runner = join(temporaryRoot, 'runner');
    const dshHome = join(temporaryRoot, 'dsh-home');
    await Promise.all([mkdir(runner), mkdir(dshHome)]);
    await writeFile(join(runner, 'package.json'), '{"private":true}\n');
    await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${config.repair.dsh_version}`], {
      cwd: runner, timeoutMs: 12 * 60_000, env: { ...process.env, CI: 'true' }, secretValues: [key],
    });
    const overlayPath = join(temporaryRoot, 'discovery.yml');
    await writeFile(overlayPath, stringify(dshRouteRows(config)));
    const dsh = join(runner, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    const prompt = `Inspect this DSH plugin repository's package manifest, README, source, and existing tests. Propose the smallest deterministic web smoke contract proving the plugin is loaded and its main behavior works. Do not edit files, use credentials, or call the model from the proposed smoke. Return exactly GUARDIAN_ONBOARD_CONTRACT then one fenced yaml block containing a complete schema: 1 contract with requires_model_turn: false, candidate-only scope, fixed fixture mode, a readiness path, and at least one plugin-specific web assertion. User hints: ${hints || '(none; discover the relevant files yourself)'}`;
    const result = await runCommand(dsh, ['--profile', 'headless', '--patch', overlayPath, prompt], {
      cwd: repoPath, timeoutMs: config.budget.max_wall_minutes * 60_000, secretValues: [key],
      displayCommand: 'dsh --profile headless --patch <ONBOARD_OVERLAY> <DISCOVERY_PROMPT>',
      env: {
        ...dshRouteEnvironment(config, key), CI: 'true', DSH_HOME: dshHome, DSH_PERMISSION_MODE: 'read-only',
        PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    });
    const match = result.stdout.match(/GUARDIAN_ONBOARD_CONTRACT[\s\S]*?```ya?ml\s*([\s\S]*?)```/i);
    if (!match) throw new GuardianError('ONBOARDING_DISCOVERY_INVALID', 'DSH did not return one complete fenced YAML contract');
    const { parse } = await import('yaml');
    return validateContract(parse(match[1]));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
      - .github/workflows/dsh-compat.yml

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
    secrets:
      deepseek_api_key: \${{ secrets.DEEPSEEK_API_KEY }}
      publisher_token: \${{ secrets.DSH_GUARDIAN_PUBLISH_TOKEN }}
      email_gateway_url: \${{ secrets.GUARDIAN_EMAIL_GATEWAY_URL }}
      telegram_bot_token: \${{ secrets.GUARDIAN_TELEGRAM_BOT_TOKEN }}
      telegram_chat_id: \${{ secrets.GUARDIAN_TELEGRAM_CHAT_ID }}
      notification_webhook_url: \${{ secrets.GUARDIAN_WEBHOOK_URL }}
`;
}

export async function scaffoldRepository(repoPath, options = {}) {
  const root = resolve(repoPath);
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const assertion = await discoverHealthAssertion(root, manifest);
  const config = structuredClone(DEFAULT_CONFIG);
  let contract;
  if (process.env[config.credentials.api_key_env] || process.env.DEEPSEEK_API_KEY) {
    contract = await discoverContractWithDsh(root, config, options.hints);
  }
  if (!contract && !assertion) {
    throw new GuardianError(
      'ONBOARDING_NEEDS_REVIEW',
      'could not deterministically discover a real plugin health assertion; add one through reviewed onboarding hints/model discovery',
    );
  }
  const discoveredByDsh = contract !== undefined;
  const packageManager = await resolvePackageManager(root, config.runtime.package_manager);
  const testCommand = packageManager.name === 'npm' ? 'npm test' : `${packageManager.name} test`;
  config.gates.repository = manifest.scripts?.test ? [testCommand, 'npm pack --dry-run'] : ['npm pack --dry-run'];
  contract ??= {
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
  return { files: [...files.keys()], assertion, discovery: discoveredByDsh ? 'dsh' : 'deterministic' };
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

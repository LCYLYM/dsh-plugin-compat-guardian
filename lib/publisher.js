import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadDeliveryPlan } from './delivery.js';
import { GuardianError } from './errors.js';
import { sha256 } from './hash.js';
import { assertRepairPaths } from './repair.js';
import { loadConfig } from './config.js';
import { runCommand } from './process.js';

function safeVersion(version) {
  return version.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function validateRepairPatch(report, patch) {
  if (patch.startsWith('[output truncated to final ')) {
    throw new GuardianError('PUBLISH_PATCH_TRUNCATED', 'repair artifact contains a truncated patch and cannot be published');
  }
  const expected = report.repair?.patchSha256;
  if (!expected || sha256(patch) !== expected) {
    throw new GuardianError('PUBLISH_PATCH_DIGEST_MISMATCH', 'repair patch digest does not match the verified report');
  }
}

export function assertPublicationPaths(paths, protectedPaths, allowManagedLock = false) {
  const checked = allowManagedLock
    ? paths.filter(path => path !== '.dsh-compat.lock.json')
    : paths;
  assertRepairPaths(checked, protectedPaths);
}

async function output(command, args, options) {
  return (await runCommand(command, args, options)).stdout.trim();
}

async function closeSuperseded(repoPath, targetBranch, currentVersion, env) {
  const raw = await output('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,url'], { cwd: repoPath, timeoutMs: 60_000, env });
  const closed = [];
  for (const item of JSON.parse(raw || '[]')) {
    if (!item.headRefName.startsWith('automation/dsh-compat/')
      || item.headRefName.startsWith('automation/dsh-compat/state/')
      || item.headRefName === targetBranch) continue;
    await runCommand('gh', ['pr', 'comment', String(item.number), '--body', `⏭️ **SUPERSEDED：已被新版本取代**\n\nGuardian 已开始处理更新的 DSH 目标 \`${currentVersion}\`。本 PR 保留作为历史证据，不会被强制改写或混入新版本修复。`], { cwd: repoPath, timeoutMs: 60_000, env });
    await runCommand('gh', ['pr', 'close', String(item.number)], { cwd: repoPath, timeoutMs: 60_000, env });
    closed.push(item.url);
  }
  return closed;
}

export async function publishVerified(options) {
  const repoPath = resolve(options.repoPath);
  const evidencePath = resolve(options.evidencePath);
  const reportPath = join(evidencePath, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const candidateVersion = report.candidate?.version;
  if (!candidateVersion) throw new GuardianError('PUBLISH_INPUT_INVALID', 'report has no candidate version');
  const actual = await output('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 });
  if (actual !== report.source?.commit) throw new GuardianError('STALE_SOURCE', `verified ${report.source?.commit}, default branch is ${actual}`);
  const { config } = await loadConfig(repoPath);
  const repair = report.kind === 'repair' || await readFile(join(evidencePath, 'repair.patch'), 'utf8').then(() => true, () => false);
  const lockName = repair ? 'verified-lock.json' : 'verified-lock.json';
  if (repair) {
    const patchPath = join(evidencePath, 'repair.patch');
    const patch = await readFile(patchPath, 'utf8');
    validateRepairPatch(report, patch);
    const applicable = await runCommand('git', ['apply', '--check', patchPath], { cwd: repoPath, timeoutMs: 60_000, reject: false });
    if (applicable.exitCode !== 0 || applicable.timedOut) {
      throw new GuardianError('PUBLISH_PATCH_INVALID', 'verified repair patch cannot be applied cleanly to the exact source commit');
    }
    await runCommand('git', ['apply', '--index', patchPath], { cwd: repoPath, timeoutMs: 60_000 });
    const repairPaths = (await output('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: repoPath,
      timeoutMs: 30_000,
    })).split('\0').filter(Boolean);
    assertPublicationPaths(repairPaths, config.repair.protected_paths);
  }
  await writeFile(resolve(repoPath, '.dsh-compat.lock.json'), await readFile(join(evidencePath, lockName)));
  await runCommand('git', ['add', '.dsh-compat.lock.json'], { cwd: repoPath, timeoutMs: 30_000 });
  const changedPaths = (await output('git', ['diff', '--cached', '--name-only', '-z'], { cwd: repoPath, timeoutMs: 30_000 })).split('\0').filter(Boolean);
  if (changedPaths.length === 0) return { status: 'NOOP', candidateVersion };
  assertPublicationPaths(changedPaths, config.repair.protected_paths, true);
  const plan = await loadDeliveryPlan(repoPath, reportPath);
  const branch = `${config.delivery.branch_prefix}/${safeVersion(candidateVersion)}`;
  const env = { ...process.env, GH_TOKEN: process.env.GH_TOKEN };
  if (!env.GH_TOKEN) throw new GuardianError('PUBLISH_TOKEN_MISSING', 'publisher job has no GitHub token');
  if (plan.effective !== 'direct-push') {
    const exists = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], { cwd: repoPath, timeoutMs: 30_000 }).then(() => true, () => false);
    if (exists) {
      const open = JSON.parse(await output('gh', ['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number,url'], {
        cwd: repoPath, timeoutMs: 60_000, env,
      }) || '[]');
      if (open.length > 0) return { status: 'WAITING_EXISTING_PR', candidateVersion, branch, prUrl: open[0].url, plan };
      await runCommand('git', ['push', 'origin', '--delete', branch], { cwd: repoPath, timeoutMs: 120_000, env });
    }
  }
  const superseded = await closeSuperseded(repoPath, branch, candidateVersion, env);
  await runCommand('git', ['config', 'user.name', 'dsh-compat-guardian[bot]'], { cwd: repoPath, timeoutMs: 30_000 });
  await runCommand('git', ['config', 'user.email', 'dsh-compat-guardian[bot]@users.noreply.github.com'], { cwd: repoPath, timeoutMs: 30_000 });
  let issueUrl;
  let issuePublished = false;
  if (plan.effective === 'direct-push') {
    const bodyPath = join(evidencePath, repair ? 'repair-report.md' : 'report.md');
    const issue = await runCommand('gh', ['issue', 'create', '--title', `[DSH Guardian] campaign ${candidateVersion}`, '--body-file', bodyPath], {
      cwd: repoPath,
      timeoutMs: 60_000,
      env,
      reject: false,
    });
    if (issue.exitCode === 0) {
      issueUrl = issue.stdout.trim();
      issuePublished = issueUrl !== '';
    }
  } else {
    await runCommand('git', ['switch', '-c', branch], { cwd: repoPath, timeoutMs: 30_000 });
  }
  const subject = `${repair ? 'fix' : 'ci'}: 支持 DSH ${candidateVersion}`;
  const message = issueUrl ? `${subject}\n\nCampaign: ${issueUrl}` : subject;
  await runCommand('git', ['commit', '-m', message], { cwd: repoPath, timeoutMs: 30_000 });
  if (plan.effective === 'direct-push') {
    const defaultBranch = process.env.GUARDIAN_DEFAULT_BRANCH;
    if (!defaultBranch) throw new GuardianError('DEFAULT_BRANCH_UNKNOWN', 'publisher did not receive the default branch name');
    await runCommand('git', ['push', 'origin', `HEAD:${defaultBranch}`], { cwd: repoPath, timeoutMs: 120_000 });
    return { status: 'PUSHED', candidateVersion, issueUrl, issuePublished, plan, superseded };
  }
  await runCommand('git', ['push', '--set-upstream', 'origin', branch], { cwd: repoPath, timeoutMs: 120_000 });
  const bodyPath = join(evidencePath, repair ? 'repair-report.md' : 'report.md');
  const createResult = await runCommand('gh', ['pr', 'create', '--head', branch, '--title', subject, '--body-file', bodyPath], {
    cwd: repoPath, timeoutMs: 60_000, env, reject: false,
  });
  if (createResult.exitCode !== 0) {
    return { status: 'WAITING_FOR_GITHUB_APPROVAL', candidateVersion, branch, plan, superseded };
  }
  const prUrl = createResult.stdout.trim();
  if (plan.effective === 'auto-merge') {
    const merged = await runCommand('gh', ['pr', 'merge', prUrl, '--auto', '--squash'], { cwd: repoPath, timeoutMs: 60_000, env }).then(() => true, () => false);
    return { status: merged ? 'AUTO_MERGE_ARMED' : 'WAITING_FOR_GITHUB_APPROVAL', candidateVersion, prUrl, plan, superseded };
  }
  return { status: 'PR_OPENED', candidateVersion, prUrl, plan, superseded };
}

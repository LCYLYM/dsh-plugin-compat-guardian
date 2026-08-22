import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';

import { stringify } from 'yaml';

import { estimateCny, readDshTokenUsage } from './budget.js';
import { loadConfig } from './config.js';
import { CommandError, GuardianError } from './errors.js';
import { sha256 } from './hash.js';
import { runCommand } from './process.js';
import { readLock, renderMarkdown, writeLockAtomic, writeReport } from './report.js';
import { verifyRepository } from './verifier.js';

function commandEvidence(name, result) {
  return {
    name,
    ok: result.exitCode === 0 && !result.timedOut,
    command: result.displayCommand,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stdoutSha256: sha256(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
    stderrSha256: sha256(result.stderr),
  };
}

function protectedMatch(path, pattern) {
  const normalized = path.replaceAll('\\', '/');
  const target = pattern.replaceAll('\\', '/');
  if (target.endsWith('/**')) return normalized === target.slice(0, -3) || normalized.startsWith(target.slice(0, -2));
  return normalized === target;
}

export function assertRepairPaths(paths, protectedPaths) {
  const blocked = paths.filter(path => protectedPaths.some(pattern => protectedMatch(path, pattern)));
  if (blocked.length > 0) throw new GuardianError('PROTECTED_PATH_CHANGED', `repair changed protected paths: ${blocked.join(', ')}`);
  for (const path of paths) {
    if (path.startsWith('/') || path.split('/').includes('..') || path === '.git' || path.startsWith('.git/')) {
      throw new GuardianError('REPAIR_PATH_ESCAPE', `repair produced unsafe path ${path}`);
    }
  }
}

export function repairResumeAllowed(previous, budget, resetBudget) {
  if (!previous?.automatic_repair_used) return true;
  if (/^[yY]$/.test(String(resetBudget ?? 'N'))) return true;
  const limits = previous.limits ?? {};
  return budget.max_tokens > (limits.max_tokens ?? budget.max_tokens)
    || budget.max_cny > (limits.max_cny ?? budget.max_cny)
    || budget.max_wall_minutes > (limits.max_wall_minutes ?? budget.max_wall_minutes);
}

function repairPrompt({ candidate, failure, config }) {
  return `You are repairing one DeepSeek Harness plugin compatibility failure in the current repository.

Target DSH: ${candidate.package}@${candidate.version}
Mechanical failure: ${failure.code}: ${failure.message}

Find the smallest compatibility fix. Inspect the repository, the installed DSH behavior, official documentation or source as needed, and run the existing tests. You may use the built-in DeepSeek search when it materially helps, but searching is optional.

Rules:
- Change only ordinary plugin files needed for this DSH compatibility failure.
- Never edit .github/workflows/**, .dsh-compat.yml, .dsh-compat.lock.json, compatibility/**, credentials, or anything outside this repository.
- Do not weaken or delete tests and do not change the smoke contract.
- Do not commit, push, open a PR, or print environment variables or credentials.
- Stop after implementing and locally checking the smallest fix. The independent Guardian verifier decides PASS.

Repository hints from onboarding: ${config.smoke.hints || '(none; discover the relevant files yourself)'}`;
}

function overlay(config) {
  const rows = [
    { id: 'agent-default-model', config: { provider: config.repair.provider, model: config.repair.model } },
    { id: 'web-search-deepseek', config: { model: config.repair.search.model } },
  ];
  return `${stringify(rows, { lineWidth: 100 })}- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
`;
}

export function repairDshArgs(overlayPath, prompt) {
  return ['--profile', 'headless', '--patch', overlayPath, prompt];
}

function credentialLike(text, secretValues) {
  if (secretValues.some(secret => secret && text.includes(secret))) return true;
  return /\bsk-[A-Za-z0-9_-]{10,}\b/.test(text)
    || /authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;}"']+/i.test(text);
}

export async function repairRepository(options) {
  const repoPath = resolve(options.repoPath ?? '.');
  const outputDirectory = resolve(options.outputDirectory ?? '.guardian-output/repair');
  await mkdir(outputDirectory, { recursive: true });
  const failureReport = JSON.parse(await readFile(resolve(options.failureReportPath), 'utf8'));
  if (failureReport.status !== 'BLOCKED' || !failureReport.candidate?.version) {
    throw new GuardianError('REPAIR_INPUT_INVALID', 'repair requires a BLOCKED verifier report with an exact candidate');
  }
  const { config } = await loadConfig(repoPath, options.configPath);
  const lockPath = resolve(repoPath, options.lockPath ?? '.dsh-compat.lock.json');
  const lock = await readLock(lockPath);
  const target = failureReport.candidate.version;
  const previous = lock.campaigns?.[target];
  if (!repairResumeAllowed(previous, config.budget, lock.resetBudget)) {
    throw new GuardianError('REPAIR_ALREADY_USED', `automatic repair for DSH ${target} was already used; increase the budget or change resetBudget from N to Y`);
  }
  if (!process.env[config.credentials.api_key_env]) {
    throw new GuardianError('MODEL_CREDENTIAL_MISSING', `required GitHub Secret is not mapped to ${config.credentials.api_key_env}`);
  }
  if (config.budget.max_tokens <= 0 || config.budget.max_cny <= 0 || config.budget.max_wall_minutes <= 0) {
    throw new GuardianError('BUDGET_EXHAUSTED', 'repair budget must be positive before starting a model request');
  }

  const startedAt = new Date().toISOString();
  const steps = [];
  let temporaryRoot;
  let report;
  const secretValues = [process.env[config.credentials.api_key_env]];
  try {
    const baseCommit = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    const clean = (await runCommand('git', ['status', '--porcelain'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    if (clean !== '') throw new GuardianError('DIRTY_SOURCE', 'repair requires a clean checkout');

    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-guardian-repair-'));
    const repairRunner = join(temporaryRoot, 'repair-runner');
    const dshHome = join(temporaryRoot, 'dsh-home');
    const overlayPath = join(temporaryRoot, 'repair.overlay.yml');
    await Promise.all([mkdir(repairRunner), mkdir(dshHome)]);
    await writeFile(join(repairRunner, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`);
    await writeFile(overlayPath, overlay(config));

    const installed = await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${config.repair.dsh_version}`], {
      cwd: repairRunner,
      timeoutMs: 12 * 60 * 1000,
      env: { ...process.env, CI: 'true' },
    });
    steps.push(commandEvidence('install-repair-dsh', installed));
    const dshBinary = join(repairRunner, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    const repairVersion = (await runCommand(dshBinary, ['--version'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();

    const modelRun = await runCommand(dshBinary, repairDshArgs(overlayPath, repairPrompt({
      candidate: failureReport.candidate,
      failure: failureReport.error,
      config,
    })), {
      cwd: repoPath,
      timeoutMs: config.budget.max_wall_minutes * 60 * 1000,
      displayCommand: 'dsh --profile headless --patch <REPAIR_OVERLAY> <REPAIR_PROMPT>',
      secretValues,
      env: {
        ...process.env,
        CI: 'true',
        DSH_HOME: dshHome,
        DSH_TOOLS_MODE: 'both',
        DSH_PERMISSION_MODE: 'workspace-write',
        PATH: `${join(repairRunner, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
        [config.credentials.base_url_env]: config.credentials.base_url,
        [config.credentials.search_base_url_env]: config.credentials.search_base_url,
      },
    });
    steps.push(commandEvidence('run-repair-dsh', modelRun));

    const headAfter = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    if (headAfter !== baseCommit) throw new GuardianError('REPAIR_COMMITTED', 'repair DSH changed Git history instead of leaving a reviewable worktree diff');
    await runCommand('git', ['add', '-A'], { cwd: repoPath, timeoutMs: 30_000 });
    const namesResult = await runCommand('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: repoPath,
      timeoutMs: 30_000,
      outputLimit: 16 * 1024 * 1024,
    });
    const changedPaths = namesResult.stdout.split('\0').filter(Boolean);
    if (changedPaths.length === 0) throw new GuardianError('REPAIR_NO_CHANGES', 'repair DSH completed without producing a repository change');
    assertRepairPaths(changedPaths, config.repair.protected_paths);
    const patchResult = await runCommand('git', ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff'], {
      cwd: repoPath,
      timeoutMs: 30_000,
      outputLimit: 16 * 1024 * 1024,
      redactOutput: false,
    });
    if (credentialLike(patchResult.stdout, secretValues)) {
      throw new GuardianError('REPAIR_SECRET_DETECTED', 'repair diff contains a credential-like value');
    }
    const numstat = (await runCommand('git', ['diff', '--cached', '--numstat'], { cwd: repoPath, timeoutMs: 30_000 })).stdout;

    const verifierReport = await verifyRepository({
      repoPath,
      dshVersion: target,
      outputDirectory: join(outputDirectory, 'verifier'),
      allowDirty: true,
    });
    if (verifierReport.status !== 'PASS') throw new GuardianError('REPAIR_NOT_VERIFIED', `independent verifier returned ${verifierReport.status}`);

    const usage = await readDshTokenUsage(join(dshHome, 'sessions'));
    const cost = estimateCny(usage, config.pricing);
    if (usage.totalTokens > config.budget.max_tokens || cost.amount > config.budget.max_cny) {
      throw new GuardianError('BUDGET_EXHAUSTED', `repair used ${usage.totalTokens} tokens and estimated ${cost.amount} CNY, above the configured campaign limit`);
    }
    const verifiedLock = await readLock(lockPath);
    verifiedLock.resetBudget = 'N';
    verifiedLock.campaigns ??= {};
    verifiedLock.campaigns[target] = {
      status: 'PASS',
      automatic_repair_used: true,
      attempts_used: 1,
      base_commit: baseCommit,
      repair_dsh_version: repairVersion,
      provider: config.repair.provider,
      model: config.repair.model,
      usage,
      estimated_cny: cost,
      active_ms: modelRun.durationMs,
      limits: {
        max_tokens: config.budget.max_tokens,
        max_cny: config.budget.max_cny,
        max_wall_minutes: config.budget.max_wall_minutes,
      },
      finished_at: new Date().toISOString(),
    };
    await writeLockAtomic(lockPath, verifiedLock);
    await Promise.all([
      writeFile(join(outputDirectory, 'repair.patch'), patchResult.stdout, { mode: 0o600 }),
      writeFile(join(outputDirectory, 'verified-lock.json'), `${JSON.stringify(verifiedLock, null, 2)}\n`, { mode: 0o600 }),
    ]);
    report = {
      schema: 1,
      status: 'PASS',
      kind: 'repair',
      startedAt,
      finishedAt: new Date().toISOString(),
      source: { commit: baseCommit },
      candidate: failureReport.candidate,
      plugin: verifierReport.plugin,
      snapshotKey: verifierReport.snapshotKey,
      repair: {
        dshVersion: repairVersion,
        provider: config.repair.provider,
        model: config.repair.model,
        changedPaths,
        numstat: numstat.trim().split('\n').filter(Boolean),
        patchSha256: sha256(patchResult.stdout),
      },
      budget: {
        usage,
        estimatedCny: cost,
        limits: config.budget,
      },
      reportUrl: verifierReport.reportUrl,
      steps: [...steps, { name: 'independent-verifier', ok: true, durationMs: 0 }],
    };
    await writeReport(report, outputDirectory);
    await writeFile(join(outputDirectory, 'repair-report.md'), `${renderMarkdown(report)}\n`, { mode: 0o600 });
    return report;
  } catch (error) {
    const guardianError = error instanceof GuardianError
      ? error
      : error instanceof CommandError
        ? error
        : new GuardianError('REPAIR_UNEXPECTED', error instanceof Error ? error.message : String(error));
    report = {
      schema: 1,
      status: 'BLOCKED',
      kind: 'repair',
      startedAt,
      finishedAt: new Date().toISOString(),
      source: failureReport.source,
      candidate: failureReport.candidate,
      plugin: failureReport.plugin,
      steps,
      error: { code: guardianError.code, message: guardianError.message },
    };
    await writeReport(report, outputDirectory);
    throw guardianError;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

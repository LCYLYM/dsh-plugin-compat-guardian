import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';

import { stringify } from 'yaml';

import { accumulateRouteCny, estimateRouteCny, readDshSearchTelemetry, readDshTokenUsage } from './budget.js';
import { addUsage, budgetState, campaignEpoch, modelInputUnchangedAfterPush, recordCampaign, repairCampaignGate, shouldSendConvergeMessage } from './campaign.js';
import { loadConfig, validateContract } from './config.js';
import { CommandError, GuardianError } from './errors.js';
import { classifyRepairDiff } from './diff-policy.js';
import { dshRouteEnvironment, dshRouteRows, routeFingerprint as fingerprintRoute } from './dsh-route.js';
import { sha256 } from './hash.js';
import { classifyModelFailure } from './model-failure.js';
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
    if (/(^|\/)(?:\.env(?:\..*)?|credentials?|secrets?|auth(?:orization)?)(?:\/|\.|$)/i.test(path)) {
      throw new GuardianError('PROTECTED_PATH_CHANGED', `repair changed a credential-like path: ${path}`);
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
- If and only if the reviewed smoke contract itself is impossible or stale, do not edit it. Instead end with GUARDIAN_CONTRACT_CHANGE_NEEDED followed by one fenced yaml block containing the complete proposed replacement contract. This creates a separate human-review-only PR and never counts as a code repair PASS.

Repository hints from onboarding: ${config.smoke.hints || '(none; discover the relevant files yourself)'}`;
}

function overlay(config) {
  const rows = dshRouteRows(config);
  return `${stringify(rows, { lineWidth: 100 })}- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
`;
}

function routeCost(usage, config) {
  return estimateRouteCny(usage, config.pricing, {
    provider: config.repair.provider,
    model: config.repair.model,
    base_url: config.credentials.base_url,
  });
}

function cumulativeRouteCost(previousCost, usageDelta, config) {
  return accumulateRouteCny(previousCost, usageDelta, config.pricing, {
    provider: config.repair.provider,
    model: config.repair.model,
    base_url: config.credentials.base_url,
  });
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
  const previousStored = lock.campaigns?.[target];
  const routeFingerprint = fingerprintRoute(config);
  const inputFingerprint = sha256(JSON.stringify({
    routeFingerprint,
    snapshotKey: failureReport.snapshotKey ?? null,
    failureCode: failureReport.error?.code ?? null,
  }));
  const gate = repairCampaignGate({
    lock,
    target,
    budget: config.budget,
    maxAttempts: config.repair.max_attempts,
    startPolicy: config.repair.start_policy,
    manualPriceOverride: process.env.GUARDIAN_REPAIR_NOW === 'true' && config.repair.allow_manual_price_override === true,
    pricing: config.pricing,
    pendingPublication: process.env.GUARDIAN_PENDING_PUBLICATION === 'true',
    trigger: process.env.GUARDIAN_TRIGGER ?? 'local',
  });
  if (gate.status !== 'READY') {
    const report = {
      schema: 1,
      status: gate.status,
      kind: 'repair-gate',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      source: failureReport.source,
      candidate: failureReport.candidate,
      plugin: failureReport.plugin,
      campaign: { target, reason: gate.reason, reset: gate.reset },
      steps: [],
    };
    await writeReport(report, outputDirectory);
    return report;
  }
  const previous = campaignEpoch(previousStored, gate.reset);
  if (modelInputUnchangedAfterPush(previousStored, inputFingerprint, process.env.GUARDIAN_TRIGGER)) {
    const report = {
      schema: 1, status: 'FROZEN', kind: 'repair-gate', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      source: failureReport.source, candidate: failureReport.candidate, plugin: failureReport.plugin,
      campaign: { target, reason: 'model-input-unchanged', reset: null }, steps: [],
      error: { code: 'MODEL_INPUT_UNCHANGED', message: '本次 push 只持久化了原阻塞状态，模型路由和兼容失败输入都没变，因此不再调模型。' },
    };
    await writeReport(report, outputDirectory);
    return report;
  }
  const routeRecovery = ['BLOCKED_CONFIG', 'BLOCKED_EXTERNAL'].includes(previousStored?.status)
    && ['workflow_dispatch', 'push'].includes(process.env.GUARDIAN_TRIGGER ?? 'local');
  if (previousStored?.route_fingerprint && previousStored.route_fingerprint !== routeFingerprint
    && gate.reset !== 'reset-budget' && !routeRecovery) {
    const report = {
      schema: 1, status: 'FROZEN', kind: 'repair-gate', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      source: failureReport.source, candidate: failureReport.candidate, plugin: failureReport.plugin,
      campaign: { target, reason: 'route-change-requires-reset', reset: null }, steps: [],
    };
    await writeReport(report, outputDirectory);
    return report;
  }
  const startedAt = new Date().toISOString();
  const steps = [];
  let temporaryRoot;
  let report;
  let dshHome;
  let modelAttempted = false;
  let modelAttempts = 0;
  let modelDurationMs = 0;
  let verifierDurationMs = 0;
  let convergeMessageSent = previous?.converge_message_sent === true;
  let lastModelOutput = '';
  const credential = process.env[config.credentials.api_key_env] ?? process.env.DEEPSEEK_API_KEY;
  const secretValues = [credential];
  try {
    if (!credential) {
      throw new GuardianError('MODEL_CREDENTIAL_MISSING', `required GitHub Secret is not mapped to ${config.credentials.api_key_env}`);
    }
    if (config.budget.max_tokens <= 0 || config.budget.max_cny <= 0 || config.budget.max_wall_minutes <= 0) {
      throw new GuardianError('BUDGET_EXHAUSTED', 'repair budget must be positive before starting a model request');
    }
    const carriedUsage = addUsage(previous?.usage);
    const carriedCost = previous?.estimated_cny ?? routeCost(carriedUsage, config);
    const carriedBudget = budgetState({
      usage: carriedUsage,
      estimatedCny: carriedCost.amount,
      activeMs: Number(previous?.active_ms ?? 0),
      attemptsUsed: Number(previous?.attempts_used ?? 0),
    }, config.budget, config.repair.max_attempts);
    if (carriedBudget.exhausted) {
      throw new GuardianError('BUDGET_EXHAUSTED', `repair campaign is already exhausted: ${carriedBudget.exhaustedBy.join(', ')}`);
    }
    const baseCommit = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    const clean = (await runCommand('git', ['status', '--porcelain'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    if (clean !== '') throw new GuardianError('DIRTY_SOURCE', 'repair requires a clean checkout');

    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-guardian-repair-'));
    const repairRunner = join(temporaryRoot, 'repair-runner');
    dshHome = join(temporaryRoot, 'dsh-home');
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
    const runModel = async (prompt, name, displayPrompt) => {
      modelAttempted = true;
      modelAttempts += 1;
      try {
        const result = await runCommand(dshBinary, repairDshArgs(overlayPath, prompt), {
          cwd: repoPath,
          timeoutMs: Math.max(1_000, config.budget.max_wall_minutes * 60 * 1000
            - Number(previous?.active_ms ?? 0) - modelDurationMs - verifierDurationMs),
          displayCommand: `dsh --profile headless --patch <REPAIR_OVERLAY> <${displayPrompt}>`,
          secretValues,
          env: {
            ...dshRouteEnvironment(config, credential),
            CI: 'true',
            DSH_HOME: dshHome,
            DSH_TOOLS_MODE: 'both',
            DSH_PERMISSION_MODE: 'workspace-write',
            PATH: `${join(repairRunner, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
          },
        });
        modelDurationMs += result.durationMs;
        lastModelOutput = result.stdout;
        steps.push(commandEvidence(name, result));
        return result;
      } catch (error) {
        if (error instanceof CommandError) {
          modelDurationMs += error.result.durationMs;
          steps.push(commandEvidence(name, error.result));
        }
        throw error;
      }
    };
    const stopForContractProposal = async () => {
      if (!lastModelOutput.includes('GUARDIAN_CONTRACT_CHANGE_NEEDED')) return;
      const match = lastModelOutput.match(/GUARDIAN_CONTRACT_CHANGE_NEEDED[\s\S]*?```ya?ml\s*([\s\S]*?)```/i);
      if (!match) throw new GuardianError('CONTRACT_PROPOSAL_INVALID', 'repair requested a contract change without one complete fenced YAML contract');
      const { parse } = await import('yaml');
      const proposal = parse(match[1]);
      validateContract(proposal);
      await writeFile(join(outputDirectory, 'contract-proposal.yml'), stringify(proposal, { lineWidth: 100 }), { mode: 0o600 });
      throw new GuardianError('BLOCKED_CONTRACT', 'repair determined that the reviewed smoke contract needs a separate human-reviewed change');
    };

    await runModel(repairPrompt({
      candidate: failureReport.candidate,
      failure: failureReport.error,
      config,
    }), 'run-repair-dsh', 'REPAIR_PROMPT');
    await stopForContractProposal();

    const firstSessionUsage = await readDshTokenUsage(join(dshHome, 'sessions'));
    const firstUsage = addUsage(previous?.usage, firstSessionUsage);
    const firstCost = cumulativeRouteCost(previous?.estimated_cny, firstSessionUsage, config);
    const firstBudgetState = budgetState({
      usage: firstUsage,
      estimatedCny: firstCost.amount,
      activeMs: Number(previous?.active_ms ?? 0) + modelDurationMs,
      attemptsUsed: Number(previous?.attempts_used ?? 0) + modelAttempts,
    }, config.budget, config.repair.max_attempts);
    if (firstBudgetState.exhausted) {
      throw new GuardianError('BUDGET_EXHAUSTED', `repair campaign exhausted: ${firstBudgetState.exhaustedBy.join(', ')}`);
    }
    if (shouldSendConvergeMessage(firstBudgetState, config.budget, convergeMessageSent)
      && modelAttempts < config.repair.max_attempts) {
      const convergePrompt = `Budget notice for the same DSH compatibility repair: only ${Math.round(firstBudgetState.remainingRatio * 100)}% of the configured campaign budget remains. Converge now. Inspect the current worktree changes, make only the smallest remaining correction, run the existing focused tests, and stop. Do not broaden scope, edit protected files, commit, push, or print credentials.`;
      await runModel(convergePrompt, 'send-converge-message', 'CONVERGE_MESSAGE');
      convergeMessageSent = true;
      await stopForContractProposal();
    }

    let changedPaths;
    let patchResult;
    let numstat;
    let verifierReport;
    let diffPolicy;
    while (true) {
      const headAfter = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
      if (headAfter !== baseCommit) throw new GuardianError('REPAIR_COMMITTED', 'repair DSH changed Git history instead of leaving a reviewable worktree diff');
      await runCommand('git', ['add', '-A'], { cwd: repoPath, timeoutMs: 30_000 });
      const namesResult = await runCommand('git', ['diff', '--cached', '--name-only', '-z'], {
        cwd: repoPath,
        timeoutMs: 30_000,
        outputLimit: 16 * 1024 * 1024,
      });
      changedPaths = namesResult.stdout.split('\0').filter(Boolean);
      if (changedPaths.length === 0) throw new GuardianError('REPAIR_NO_CHANGES', 'repair DSH completed without producing a repository change');
      assertRepairPaths(changedPaths, config.repair.protected_paths);
      patchResult = await runCommand('git', ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff'], {
        cwd: repoPath,
        timeoutMs: 30_000,
        outputLimit: 16 * 1024 * 1024,
        redactOutput: false,
      });
      if (credentialLike(patchResult.stdout, secretValues)) {
        throw new GuardianError('REPAIR_SECRET_DETECTED', 'repair diff contains a credential-like value');
      }
      numstat = (await runCommand('git', ['diff', '--cached', '--numstat'], { cwd: repoPath, timeoutMs: 30_000 })).stdout;
      diffPolicy = await classifyRepairDiff(repoPath, changedPaths, numstat, config);
      try {
        verifierReport = await verifyRepository({
          repoPath,
          dshVersion: target,
          outputDirectory: join(outputDirectory, `verifier-attempt-${modelAttempts}`),
          allowDirty: true,
        });
      } catch (error) {
        if (!error?.report) throw error;
        verifierReport = error.report;
      }
      const thisVerifierMs = verifierReport.steps?.reduce((total, step) => total + Number(step.durationMs ?? 0), 0) ?? 0;
      verifierDurationMs += thisVerifierMs;
      steps.push({
        name: `independent-verifier-attempt-${modelAttempts}`,
        ok: verifierReport.status === 'PASS',
        durationMs: 0,
        errorCode: verifierReport.error?.code,
      });
      if (verifierReport.status === 'PASS') break;
      if (modelAttempts >= config.repair.max_attempts) {
        throw new GuardianError('REPAIR_NOT_VERIFIED', `independent verifier returned ${verifierReport.status} after ${modelAttempts} attempts`);
      }
      const interimSessionUsage = await readDshTokenUsage(join(dshHome, 'sessions'));
      const interimUsage = addUsage(previous?.usage, interimSessionUsage);
      const interimCost = cumulativeRouteCost(previous?.estimated_cny, interimSessionUsage, config);
      const interimBudget = budgetState({
        usage: interimUsage,
        estimatedCny: interimCost.amount,
        activeMs: Number(previous?.active_ms ?? 0) + modelDurationMs + verifierDurationMs,
        attemptsUsed: Number(previous?.attempts_used ?? 0) + modelAttempts,
      }, config.budget, config.repair.max_attempts);
      if (interimBudget.exhausted) {
        throw new GuardianError('BUDGET_EXHAUSTED', `repair campaign exhausted before refinement: ${interimBudget.exhaustedBy.join(', ')}`);
      }
      await runCommand('git', ['reset'], { cwd: repoPath, timeoutMs: 30_000 });
      const convergenceNotice = shouldSendConvergeMessage(interimBudget, config.budget, convergeMessageSent)
        ? ` Only ${Math.round(interimBudget.remainingRatio * 100)}% of the configured campaign budget remains, so converge now.`
        : '';
      await runModel(`The independent Guardian verifier rejected the current repair with ${verifierReport.error?.code ?? verifierReport.status}: ${verifierReport.error?.message ?? 'mechanical gates did not pass'}.${convergenceNotice} Inspect the existing worktree diff and verifier evidence, make the smallest correction, run focused tests, and stop. Do not edit protected files, weaken tests, commit, push, or print credentials.`, 'run-repair-refinement', 'REFINEMENT_PROMPT');
      if (convergenceNotice !== '') convergeMessageSent = true;
      await stopForContractProposal();
    }

    const currentUsage = await readDshTokenUsage(join(dshHome, 'sessions'));
    const search = await readDshSearchTelemetry(join(dshHome, 'sessions'));
    search.model = config.repair.search.model;
    const usage = addUsage(previous?.usage, currentUsage);
    const cost = cumulativeRouteCost(previous?.estimated_cny, currentUsage, config);
    const attemptsUsed = Number(previous?.attempts_used ?? 0) + modelAttempts;
    const activeMs = Number(previous?.active_ms ?? 0) + modelDurationMs + verifierDurationMs;
    const budgetSnapshot = budgetState({ usage, estimatedCny: cost.amount, activeMs, attemptsUsed }, config.budget, config.repair.max_attempts);
    if (budgetSnapshot.exhausted) {
      throw new GuardianError('BUDGET_EXHAUSTED', `repair campaign exhausted: ${budgetSnapshot.exhaustedBy.join(', ')}`);
    }
    const verifiedLock = await readLock(lockPath);
    const campaign = {
      epoch: Number(previous?.epoch ?? 1),
      history: previous?.history ?? [],
      lifetime_usage: previous?.lifetime_usage,
      lifetime_active_ms: Number(previous?.lifetime_active_ms ?? 0),
      lifetime_attempts: Number(previous?.lifetime_attempts ?? 0),
      status: 'PASS',
      automatic_repair_used: true,
      attempts_used: attemptsUsed,
      base_commit: baseCommit,
      repair_dsh_version: repairVersion,
      provider: config.repair.provider,
      model: config.repair.model,
      route_fingerprint: routeFingerprint,
      input_fingerprint: inputFingerprint,
      usage,
      estimated_cny: cost,
      active_ms: activeMs,
      converge_message_sent: convergeMessageSent,
      converge_message_due: shouldSendConvergeMessage(budgetSnapshot, config.budget, convergeMessageSent),
      limits: {
        max_tokens: config.budget.max_tokens,
        max_cny: config.budget.max_cny,
        max_wall_minutes: config.budget.max_wall_minutes,
        max_attempts: config.repair.max_attempts,
      },
      finished_at: new Date().toISOString(),
    };
    const nextLock = recordCampaign(verifiedLock, target, campaign);
    await writeLockAtomic(lockPath, nextLock);
    await Promise.all([
      writeFile(join(outputDirectory, 'repair.patch'), patchResult.stdout, { mode: 0o600 }),
      writeFile(join(outputDirectory, 'verified-lock.json'), `${JSON.stringify(nextLock, null, 2)}\n`, { mode: 0o600 }),
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
        diffPolicy,
        search,
      },
      budget: {
        usage,
        estimatedCny: cost,
        limits: config.budget,
        state: budgetSnapshot,
      },
      campaign: {
        epoch: campaign.epoch,
        converge_message_sent: campaign.converge_message_sent,
      },
      reportUrl: verifierReport.reportUrl,
      steps,
    };
    await writeReport(report, outputDirectory);
    await writeFile(join(outputDirectory, 'repair-report.md'), `${renderMarkdown(report)}\n`, { mode: 0o600 });
    return report;
  } catch (error) {
    if (error instanceof CommandError) {
      modelDurationMs = Math.max(modelDurationMs, Number(error.result?.durationMs ?? 0));
      if (modelAttempted && !steps.some(step => step.name === 'run-repair-dsh')) {
        steps.push(commandEvidence('run-repair-dsh', error.result));
      }
    }
    const rawError = error instanceof GuardianError
      ? error
      : error instanceof CommandError
        ? error
        : new GuardianError('REPAIR_UNEXPECTED', error instanceof Error ? error.message : String(error));
    const failure = classifyModelFailure(rawError);
    const guardianError = new GuardianError(failure.code, failure.message, {
      originalCode: failure.originalCode,
      status: failure.status,
      retryable: failure.retryable,
    });
    let usage = previous?.usage;
    if (dshHome) {
      try {
        usage = addUsage(previous?.usage, await readDshTokenUsage(join(dshHome, 'sessions')));
      } catch {
        // A provider/runner failure can leave no readable session; keep prior durable usage.
      }
    }
    const currentUsage = usage ? Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, Number(value ?? 0) - Number(previous?.usage?.[key] ?? 0)])) : undefined;
    const cost = currentUsage ? cumulativeRouteCost(previous?.estimated_cny, currentUsage, config) : undefined;
    const consumesRepairAttempt = ['BLOCKED', 'BLOCKED_CONTRACT'].includes(failure.status);
    const attemptsUsed = Number(previous?.attempts_used ?? 0) + (consumesRepairAttempt ? modelAttempts : 0);
    const activeMs = Number(previous?.active_ms ?? 0) + modelDurationMs + verifierDurationMs;
    const state = budgetState({ usage, estimatedCny: cost?.amount, activeMs, attemptsUsed }, config.budget, config.repair.max_attempts);
    const blockedStatus = failure.status;
    const blockedLock = recordCampaign(lock, target, {
      epoch: Number(previous?.epoch ?? 1),
      history: previous?.history ?? [],
      lifetime_usage: previous?.lifetime_usage,
      lifetime_active_ms: Number(previous?.lifetime_active_ms ?? 0),
      lifetime_attempts: Number(previous?.lifetime_attempts ?? 0),
      status: blockedStatus,
      automatic_repair_used: previous?.automatic_repair_used === true || (consumesRepairAttempt && modelAttempted),
      attempts_used: attemptsUsed,
      base_commit: failureReport.source?.commit,
      repair_dsh_version: config.repair.dsh_version,
      provider: config.repair.provider,
      model: config.repair.model,
      route_fingerprint: routeFingerprint,
      input_fingerprint: inputFingerprint,
      usage,
      estimated_cny: cost,
      active_ms: activeMs,
      converge_message_sent: convergeMessageSent,
      converge_message_due: shouldSendConvergeMessage(state, config.budget, convergeMessageSent),
      limits: {
        max_tokens: config.budget.max_tokens,
        max_cny: config.budget.max_cny,
        max_wall_minutes: config.budget.max_wall_minutes,
        max_attempts: config.repair.max_attempts,
      },
      blocker: { code: guardianError.code, message: guardianError.message },
      finished_at: new Date().toISOString(),
    });
    await writeFile(join(outputDirectory, 'blocked-lock.json'), `${JSON.stringify(blockedLock, null, 2)}\n`, { mode: 0o600 });
    report = {
      schema: 1,
      status: blockedStatus,
      kind: 'repair',
      startedAt,
      finishedAt: new Date().toISOString(),
      source: failureReport.source,
      candidate: failureReport.candidate,
      plugin: failureReport.plugin,
      steps,
      budget: usage ? { usage, estimatedCny: cost, limits: config.budget, state } : undefined,
      campaign: {
        epoch: Number(previous?.epoch ?? 1),
        converge_message_sent: convergeMessageSent,
      },
      error: { code: guardianError.code, message: guardianError.message },
    };
    await writeReport(report, outputDirectory);
    throw guardianError;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

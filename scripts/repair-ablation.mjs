// Two independent copies of one real plugin commit, exact candidate, model,
// route, and campaign budget. No publishing, source reset, or mocked verifier.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runCommand } from '../lib/process.js';
import { verifyRepository } from '../lib/verifier.js';
import { collectRepairPaths, repairRepository } from '../lib/repair.js';

const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const target = process.argv[4] ?? '0.2.1-alpha.2';
const summarizeOnly = process.argv.includes('--summarize-only');
await mkdir(output, { recursive: true });
let commit = (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
if (!summarizeOnly && (await runCommand('git', ['status', '--porcelain'], { cwd: repository })).stdout.trim()) throw new Error('Ablation input must be clean');
const results = [];
for (const arm of ['control', 'on-demand-guidance']) {
  const clone = join(output, arm, 'repository');
  const evidence = join(output, arm, 'evidence');
  await mkdir(evidence, { recursive: true });
  if (!summarizeOnly) await runCommand('git', ['clone', '--no-hardlinks', repository, clone], { timeoutMs: 120_000 });
  let failure;
  let report;
  if (summarizeOnly) {
    failure = JSON.parse(await readFile(join(evidence, 'before', 'report.json'), 'utf8'));
    report = JSON.parse(await readFile(join(evidence, 'repair', 'report.json'), 'utf8'));
    if (results.length === 0) commit = failure.source.commit;
    if (failure.source.commit !== commit) throw new Error('Ablation arms do not share one source commit');
  } else {
  try {
    await verifyRepository({ repoPath: clone, dshVersion: target, skipNoop: true,
      outputDirectory: join(evidence, 'before') });
    throw new Error('Real input has no compatibility failure; do not fabricate one for this comparison');
  } catch (error) {
    failure = error.report;
    if (failure?.status !== 'BLOCKED' || failure.repairEligible !== true) throw error;
  }
  try {
    report = await repairRepository({ repoPath: clone,
      failureReportPath: join(evidence, 'before', 'report.json'), outputDirectory: join(evidence, 'repair'),
      migrationGuidance: arm !== 'control' });
  } catch {
    report = JSON.parse(await readFile(join(evidence, 'repair', 'report.json'), 'utf8'));
  }
  }
  const observedPaths = (await collectRepairPaths(clone)).filter(path => path !== '.dsh-compat.lock.json');
  const observedNumstat = (await runCommand('git', ['diff', 'HEAD', '--numstat', '--', '.', ':!.dsh-compat.lock.json'], { cwd: clone })).stdout.trim().split('\n').filter(Boolean);
  const result = { arm, commit, target, originalFailure: failure.error?.code,
    status: report.status, error: report.error?.code ?? null,
    attempts: report.steps.filter(step => /^run-repair/.test(step.name)).length,
    tokens: report.budget?.usage?.totalTokens ?? null,
    durationMs: Date.parse(report.finishedAt) - Date.parse(report.startedAt),
    changedPaths: report.repair?.changedPaths ?? observedPaths, numstat: report.repair?.numstat ?? observedNumstat,
    independentVerifier: report.steps.filter(step => step.name.startsWith('independent-verifier-attempt-')),
    guidance: report.repair?.migrationGuidance ?? report.migrationGuidance ?? null };
  results.push(result);
  await writeFile(join(output, 'comparison.json'), `${JSON.stringify({ commit, target, results }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ arm, status: result.status, error: result.error, tokens: result.tokens, attempts: result.attempts })}\n`);
}

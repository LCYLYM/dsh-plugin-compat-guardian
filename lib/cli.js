import { resolve } from 'node:path';

import { GuardianError } from './errors.js';
import { loadDeliveryPlan } from './delivery.js';
import { onboardRepository, scaffoldRepository } from './onboard.js';
import { publishVerified } from './publisher.js';
import { notifyFromReport } from './notifier.js';
import { runCandidateModelSmoke } from './model-smoke.js';
import { repairRepository } from './repair.js';
import { verifyRepository } from './verifier.js';

const HELP = `Usage:
  dsh-plugin-compat-guardian verify [options]
  dsh-plugin-compat-guardian scaffold [options]
  dsh-plugin-compat-guardian onboard [options]
  dsh-plugin-compat-guardian repair [options]
  dsh-plugin-compat-guardian delivery-plan [options]
  dsh-plugin-compat-guardian publish [options]
  dsh-plugin-compat-guardian notify [options]
  dsh-plugin-compat-guardian model-smoke [options]

verify options:
  --repo <path>             plugin repository (default: .)
  --dsh-version <spec>      exact version or dist-tag (default: config latest)
  --config <path>           config path inside repository
  --contract <path>         smoke contract path inside repository
  --lock <path>             lock path inside repository
  --output <path>           report directory (default: .guardian-output)
  --allow-dirty             permit a dirty local tree (never use in CI)
  --keep-temp               retain isolated runtime for debugging

scaffold/onboard options:
  --repo <path>             target repository
  --guardian-ref <ref>      owner/repo/workflow.yml@<40-char SHA>
  --no-workflow             M0 local scaffold only
  --no-pr                   create a local onboarding branch without push/PR
  --branch <name>           onboarding branch name
  --hints <text>            optional natural-language smoke discovery hints

repair options:
  --repo <path>             clean repair checkout
  --failure-report <path>   BLOCKED verifier report.json
  --output <path>           repair evidence directory

delivery-plan options:
  --repo <path>             plugin repository
  --report <path>           optional repair report.json

publish options:
  --repo <path>             publisher checkout
  --evidence <path>         verified artifact directory

notify options:
  --repo <path>             plugin repository
  --report <path>           final report.json

model-smoke options:
  --repo <path>             plugin repository
  --dsh-version <version>   exact candidate DSH version
  --output <path>           sanitized model-smoke report directory
  --base-lock <path>        verified deterministic lock artifact
`;

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { command: 'help', options: {} };
    if (['--allow-dirty', '--keep-temp', '--no-workflow', '--no-pr'].includes(token)) {
      options[token.slice(2).replaceAll('-', '_')] = true;
      continue;
    }
    if (!token.startsWith('--')) throw new GuardianError('CLI_USAGE', `unexpected argument ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new GuardianError('CLI_USAGE', `${token} needs a value`);
    options[token.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  return { command, options };
}

export async function main(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }
  const { command, options } = parseArgs(argv);
  if (command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  const repoPath = resolve(options.repo ?? '.');
  if (command === 'verify') {
    const report = await verifyRepository({
      repoPath,
      dshVersion: options.dsh_version,
      configPath: options.config,
      contractPath: options.contract,
      lockPath: options.lock,
      outputDirectory: options.output ?? '.guardian-output',
      allowDirty: options.allow_dirty,
      keepTemp: options.keep_temp,
    });
    process.stdout.write(`${report.status} ${report.candidate.version} ${report.snapshotKey}\n`);
    return;
  }
  if (command === 'scaffold') {
    const result = await scaffoldRepository(repoPath, {
      guardianRef: options.guardian_ref,
      noWorkflow: options.no_workflow,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'onboard') {
    const result = await onboardRepository({
      repoPath,
      guardianRef: options.guardian_ref,
      noWorkflow: options.no_workflow,
      noPr: options.no_pr,
      branch: options.branch,
      hints: options.hints,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'repair') {
    if (!options.failure_report) throw new GuardianError('CLI_USAGE', 'repair requires --failure-report');
    const report = await repairRepository({
      repoPath,
      failureReportPath: options.failure_report,
      outputDirectory: options.output ?? '.guardian-output/repair',
      configPath: options.config,
      lockPath: options.lock,
    });
    process.stdout.write(`${report.status} ${report.candidate.version}${report.repair?.patchSha256 ? ` ${report.repair.patchSha256}` : ''}\n`);
    return;
  }
  if (command === 'delivery-plan') {
    process.stdout.write(`${JSON.stringify(await loadDeliveryPlan(repoPath, options.report))}\n`);
    return;
  }
  if (command === 'publish') {
    if (!options.evidence) throw new GuardianError('CLI_USAGE', 'publish requires --evidence');
    process.stdout.write(`${JSON.stringify(await publishVerified({ repoPath, evidencePath: options.evidence }))}\n`);
    return;
  }
  if (command === 'notify') {
    if (!options.report) throw new GuardianError('CLI_USAGE', 'notify requires --report');
    process.stdout.write(`${JSON.stringify(await notifyFromReport({ repoPath, reportPath: options.report }))}\n`);
    return;
  }
  if (command === 'model-smoke') {
    if (!options.dsh_version) throw new GuardianError('CLI_USAGE', 'model-smoke requires --dsh-version');
    const result = await runCandidateModelSmoke({ repoPath, dshVersion: options.dsh_version, outputDirectory: options.output, baseLockPath: options.base_lock });
    process.stdout.write(`${result.status} ${options.dsh_version}\n`);
    return;
  }
  throw new GuardianError('CLI_USAGE', `unknown command ${JSON.stringify(command)}\n\n${HELP}`);
}

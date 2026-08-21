import { resolve } from 'node:path';

import { GuardianError } from './errors.js';
import { onboardRepository, scaffoldRepository } from './onboard.js';
import { verifyRepository } from './verifier.js';

const HELP = `Usage:
  dsh-plugin-compat-guardian verify [options]
  dsh-plugin-compat-guardian scaffold [options]
  dsh-plugin-compat-guardian onboard [options]

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
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new GuardianError('CLI_USAGE', `unknown command ${JSON.stringify(command)}\n\n${HELP}`);
}

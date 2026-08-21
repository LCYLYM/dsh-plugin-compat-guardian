import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function duration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function fenced(value) {
  const text = String(value ?? '').trim();
  return text === '' ? '_none_' : `\n\`\`\`text\n${text}\n\`\`\``;
}

export function renderMarkdown(report) {
  const lines = [
    '# DSH compatibility report',
    '',
    `- Status: **${report.status}**`,
    `- Repository commit: \`${report.source?.commit ?? 'unknown'}\``,
    `- Candidate: \`${report.candidate?.package ?? 'unknown'}@${report.candidate?.version ?? 'unknown'}\``,
    `- Root integrity: \`${report.candidate?.integrity ?? 'unknown'}\``,
    `- Install graph digest: \`${report.candidate?.graphDigest ?? 'unknown'}\``,
    `- Plugin tarball SHA-256: \`${report.plugin?.tarballSha256 ?? 'not-packed'}\``,
    `- Snapshot key: \`${report.snapshotKey ?? 'unknown'}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '## Gates',
    '',
    '| Gate | Result | Duration |',
    '| --- | --- | ---: |',
  ];
  for (const step of report.steps ?? []) {
    lines.push(`| ${step.name} | ${step.ok ? 'PASS' : 'FAIL'} | ${duration(step.durationMs ?? 0)} |`);
  }
  if (report.error) {
    lines.push('', '## Blocking error', '', `- Code: \`${report.error.code}\``, `- Message: ${report.error.message}`);
  }
  const failed = (report.steps ?? []).find(step => !step.ok);
  if (failed?.stderr || failed?.stdout) {
    lines.push('', '## Sanitized failing output', '');
    if (failed.stdout) lines.push('stdout:', fenced(failed.stdout));
    if (failed.stderr) lines.push('stderr:', fenced(failed.stderr));
  }
  lines.push('', '> This report stores sanitized mechanical evidence only. It contains no model conversation or credentials.', '');
  return lines.join('\n');
}

export function actionsReportUrl(env = process.env) {
  if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return null;
  return `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

export async function writeReport(report, outputDirectory) {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const markdown = renderMarkdown(report);
  const jsonPath = resolve(directory, 'report.json');
  const markdownPath = resolve(directory, 'report.md');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    writeFile(markdownPath, `${markdown}\n`, { mode: 0o600 }),
  ]);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  return { jsonPath, markdownPath, markdown };
}

export async function readLock(lockPath) {
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if (lock.schema !== 1) throw new Error('lock schema must be 1');
    return lock;
  } catch (error) {
    if (error?.code === 'ENOENT') return { schema: 1, resetBudget: 'N', verified: null, campaigns: {} };
    throw error;
  }
}

export async function writeLockAtomic(lockPath, lock) {
  await mkdir(dirname(lockPath), { recursive: true });
  const temporary = `${lockPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, lockPath);
}

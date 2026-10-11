// Real Anna + real released DSH CLI. No plugin edits, fake responses, or keys
// in artifacts. This probe does not stand in for the consumer upgrade verifier.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadConfig } from '../lib/config.js';
import { dshRunnerManifest, dshRunnerPatches } from '../lib/dsh-runner.js';
import { dshRouteRows, dshRouteEnvironment } from '../lib/dsh-route.js';
import { readDshTokenUsage } from '../lib/budget.js';
import { redactText, runCommand } from '../lib/process.js';
import { sha256 } from '../lib/hash.js';
import { finalText } from '../lib/model-smoke.js';

const repo = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const version = process.argv[4] ?? '0.2.1-alpha.2';
const { config } = await loadConfig(repo);
const credential = process.env[config.credentials.api_key_env];
if (!credential) throw new Error('Configured key is missing');
const root = await mkdtemp(join(tmpdir(), 'guardian-anna-cli-probe-'));
await mkdir(output, { recursive: true });
const runner = join(root, 'runner');
const home = join(root, 'home');
const sessions = join(home, 'sessions');
await Promise.all([mkdir(runner), mkdir(home)]);
let report;
try {
  await writeFile(join(runner, 'package.json'), `${JSON.stringify(dshRunnerManifest(version))}\n`);
  await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${version}`], { cwd: runner, env: { ...process.env, CI: 'true' }, timeoutMs: 720_000 });
  const overlay = join(root, 'probe.yml');
  await writeFile(overlay, stringify([...dshRunnerPatches(version), ...dshRouteRows(config),
    { id: 'session-persistence-jsonl', config: { root: sessions, compression: 'none' } }]));
  const env = { ...dshRouteEnvironment(config, credential), CI: 'true', DSH_HOME: home,
    DSH_TOOLS_MODE: 'native', DSH_PERMISSION_MODE: 'workspace-write',
    PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH}` };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  const nonce = `ANNA_CLI_${crypto.randomUUID()}`;
  const result = await runCommand(join(runner, 'node_modules', '.bin', 'dsh'), ['--profile', 'headless', '--patch', overlay,
    `Use one read-only bash tool to run pwd, then reply only ${nonce}. Do not edit files, read credentials/environment variables, or inspect raw Session logs.`], {
      cwd: repo, env, secretValues: [credential], timeoutMs: 300_000,
      displayCommand: 'dsh --profile headless --patch <PROBE_OVERLAY> <READ_ONLY_PROBE>' });
  const events = [];
  for (const file of (await readdir(sessions, { recursive: true })).filter(name => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(sessions, file), 'utf8')).split('\n')) {
      try { events.push(JSON.parse(line)); } catch {}
    }
  }
  const types = [...new Set(events.map(event => event.type))].sort();
  const terminal = events.findLast(event => event.type === 'turn/end');
  const final = finalText(events);
  if (!['tool/call', 'tool/result', 'assistant/message', 'turn/end'].every(type => types.includes(type))
    || terminal?.data?.reason?.kind !== 'completed' || !final.includes(nonce)) throw new Error('Native CLI did not complete the real tool probe');
  report = { status: 'PASS', dshVersion: version, model: config.repair.model, reasoningEffort: config.repair.reasoning_effort,
    eventTypes: types, durationMs: result.durationMs, usage: await readDshTokenUsage(sessions), finalSha256: sha256(final), imageInput: false };
} catch (error) {
  report = { status: 'BLOCKED', dshVersion: version, code: error.code ?? 'CLI_PROBE_FAILED',
    diagnostic: redactText(error.result?.stderr ?? error.message, [credential]).replaceAll(root, '<PROBE_TEMP>').replaceAll(repo, '<REPOSITORY>').slice(0, 1000),
    usage: await readDshTokenUsage(sessions) };
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({ status: report.status, code: report.code, usage: report.usage })}\n`);

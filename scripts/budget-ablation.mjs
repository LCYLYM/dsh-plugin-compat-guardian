import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadConfig } from '../lib/config.js';
import { dshRouteEnvironment, dshRouteRows } from '../lib/dsh-route.js';
import { dshRunnerManifest } from '../lib/dsh-runner.js';
import { readDshTokenUsage, estimateRouteCny } from '../lib/budget.js';
import { runBudgetedCommand } from '../lib/bounded-model.js';
import { runCommand } from '../lib/process.js';

const repo = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const version = '0.2.1-alpha.2';
const { config } = await loadConfig(repo);
const key = process.env[config.credentials.api_key_env];
if (!key) throw new Error('Configured key is missing');
const root = await mkdtemp(join(tmpdir(), 'guardian-budget-ablation-'));
const runner = join(root, 'runner');
await Promise.all([mkdir(output, { recursive: true }), mkdir(runner)]);
const results = [];
try {
  await writeFile(join(runner, 'package.json'), JSON.stringify(dshRunnerManifest(version)));
  await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${version}`], { cwd: runner, timeoutMs: 720_000 });
  for (const arm of ['control', 'live-ledger-stop']) {
    const home = join(root, arm);
    const sessions = join(home, 'sessions');
    await mkdir(home);
    const overlay = join(home, 'probe.yml');
    await writeFile(overlay, stringify([...dshRouteRows(config),
      { id: 'session-persistence-jsonl', config: { root: sessions, compression: 'none' } }]));
    const options = { cwd: repo, timeoutMs: 120_000, secretValues: [key],
      displayCommand: 'dsh <REAL_NATIVE_BUDGET_PROBE>', env: {
        ...dshRouteEnvironment(config, key), CI: 'true', DSH_HOME: home,
        DSH_TOOLS_MODE: 'native', DSH_PERMISSION_MODE: 'workspace-write',
        PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH}`,
      } };
    const nonce = 'GUARDIAN_BUDGET_PROBE_COMPLETED';
    const args = ['--profile', 'headless', '--patch', overlay,
      `Use one read-only bash tool to run pwd and sleep 12 seconds, then reply only ${nonce}. Do not edit files, read credentials/environment, or inspect raw Session logs.`];
    let result;
    let error;
    try {
      result = arm === 'control' ? await runCommand(join(runner, 'node_modules', '.bin', 'dsh'), args, options)
        : await runBudgetedCommand(join(runner, 'node_modules', '.bin', 'dsh'), args, options, {
          sessionsRoot: sessions, activeMsBefore: 0, attemptsUsed: 1, maxAttempts: 2,
          limits: { ...config.budget, max_tokens: 1_024 },
          cost: delta => estimateRouteCny(delta, config.pricing, { provider: config.repair.provider,
            model: config.repair.model, base_url: config.credentials.base_url }),
        });
    } catch (caught) { error = caught; result = caught.result ?? caught.details?.result; }
    const events = [];
    for (const file of (await readdir(sessions, { recursive: true }).catch(() => [])).filter(name => name.endsWith('.jsonl'))) {
      for (const line of (await readFile(join(sessions, file), 'utf8')).split('\n')) {
        try { events.push(JSON.parse(line)); } catch {}
      }
    }
    const completed = events.findLast(event => event.type === 'turn/end')?.data?.reason?.kind === 'completed';
    const pass = arm === 'control' ? result?.exitCode === 0 && completed && result.stdout.includes(nonce)
      : error?.code === 'BUDGET_EXHAUSTED' && result?.aborted === true && result?.timedOut === false;
    results.push({ arm, pass, code: error?.code ?? null, completed,
      aborted: result?.aborted ?? false, durationMs: result?.durationMs,
      eventTypes: [...new Set(events.map(event => event.type))].sort(), usage: await readDshTokenUsage(sessions) });
    await writeFile(join(output, 'comparison.json'), JSON.stringify({ dshVersion: version,
      model: config.repair.model, reasoningEffort: config.repair.reasoning_effort,
      measuredThreshold: 1_024, results }, null, 2));
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  }
} finally { await rm(root, { recursive: true, force: true }); }
if (!results.every(item => item.pass)) process.exitCode = 1;

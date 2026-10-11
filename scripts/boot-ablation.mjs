import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { stringify } from 'yaml';
import { dshRunnerManifest } from '../lib/dsh-runner.js';
import { runCommand, startService } from '../lib/process.js';
import { establishWebSession } from '../lib/verifier.js';

// A real two-factor process comparison, no model keys or calls. Each runner
// keeps its exact graph frozen across trials; each boot gets a fresh home.
const root = process.argv[3] ?? await mkdtemp(join(tmpdir(), 'guardian-boot-ablation-'));
const version = process.argv[2] ?? '0.1.1-rc.2';
const results = [];
for (const arm of ['control', 'compatible-released-hmr', 'preinitialized-hmr', 'compatible-preinitialized-hmr']) {
  const runner = join(root, arm, 'runner');
  await mkdir(runner, { recursive: true });
  await writeFile(join(runner, 'package.json'), `${JSON.stringify(arm.startsWith('compatible') ? dshRunnerManifest(version) : { private: true })}\n`);
  const installed = await access(join(runner, 'node_modules', '.bin', 'dsh')).then(() => true, () => false);
  if (!installed) await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${version}`], {
    cwd: runner, env: { ...process.env, CI: 'true' }, timeoutMs: 720_000,
  });
  for (let trial = 1; trial <= Number(process.env.GUARDIAN_ABLATION_TRIALS ?? 3); trial += 1) {
    const home = await mkdtemp(join(root, `${arm}-${trial}-`));
    const overlay = join(home, 'boot.yml');
    await writeFile(overlay, stringify(arm.includes('preinitialized') ? [{ insert: [
      { id: 'guardian-runtime-hmr', name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } },
    ] }] : []));
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = socket.address().port;
    socket.close();
    await once(socket, 'close');
    const service = startService(join(runner, 'node_modules', '.bin', 'dsh'),
      ['--profile', 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', String(port)], {
        cwd: root, env: { ...process.env, CI: 'true', DSH_HOME: home,
          PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH}` },
      });
    try {
      const session = await establishWebSession(`http://127.0.0.1:${port}`, service, 20_000);
      // Boot success must survive startup, not just print a listening URL.
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (service.exited) throw new Error('WEB_EXITED_AFTER_READY');
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: session.cookie ? { cookie: session.cookie } : {}, signal: AbortSignal.timeout(2000),
      });
      if (response.status !== 200) throw new Error(`HTTP_${response.status}`);
      results.push({ arm, trial, pass: true, durationMs: session.durationMs });
    } catch (error) {
      results.push({ arm, trial, pass: false, code: error.code ?? error.message,
        hmrFailure: service.snapshot().stderr.includes('requires the Cordis HMR service'),
        diagnostic: service.snapshot().stderr.replaceAll(root, '<RUNTIME>').replace(/\s+/g, ' ').slice(0, 1500) });
    } finally { await service.stop(); }
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  }
}
const summary = { version, results };
if (process.env.GUARDIAN_ABLATION_OUTPUT) await writeFile(process.env.GUARDIAN_ABLATION_OUTPUT, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(summary)}\n`);

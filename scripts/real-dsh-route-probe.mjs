import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { stringify } from 'yaml';

import { DEFAULT_CONFIG } from '../lib/config.js';
import { dshRouteEnvironment, dshRouteRows } from '../lib/dsh-route.js';
import { GuardianError } from '../lib/errors.js';
import { classifyModelFailure } from '../lib/model-failure.js';
import { runCommand } from '../lib/process.js';
import { repairRepository } from '../lib/repair.js';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'guardian-real-dsh-route-'));
const requests = [];
let responseStatus = 200;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({ url: request.url, authorization: request.headers.authorization, body });
  if (responseStatus === 'timeout') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    await new Promise(resolve => setTimeout(resolve, 1_000));
    response.end();
    return;
  }
  if (responseStatus === 'bad-model' || responseStatus === 'not-found') {
    const status = responseStatus === 'bad-model' ? 400 : 404;
    const message = responseStatus === 'bad-model' ? 'model not found: guardian-custom-model' : 'endpoint not found';
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message, type: 'probe_error' } }));
    return;
  }
  if (responseStatus !== 200) {
    response.writeHead(responseStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `probe HTTP ${responseStatus}`, type: 'probe_error' } }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write('data: {"id":"guardian-probe","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"route ok"}}]}\n\n');
  response.write('data: {"id":"guardian-probe","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n');
  response.end('data: [DONE]\n\n');
});

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const runner = join(temporaryRoot, 'runner');
  const dshHome = join(temporaryRoot, 'dsh-home');
  await Promise.all([mkdir(runner), mkdir(dshHome)]);
  await writeFile(join(runner, 'package.json'), '{"private":true}\n');
  await runCommand('pnpm', ['add', '--save-exact', '@deepseek-ai/dsh@0.1.1-rc.2'], {
    cwd: runner, timeoutMs: 12 * 60_000, env: { ...process.env, CI: 'true' },
  });
  const config = structuredClone(DEFAULT_CONFIG);
  config.repair.search.enabled = false;
  config.repair.model = 'guardian-custom-model';
  config.credentials.api_key_env = 'GUARDIAN_CUSTOM_KEY';
  config.credentials.base_url = `http://127.0.0.1:${server.address().port}`;
  const overlay = join(temporaryRoot, 'route.yml');
  const rows = dshRouteRows(config);
  rows.find(row => row.id === 'llm-deepseek').config.streamIdleTimeoutMs = 500;
  await writeFile(overlay, stringify(rows));
  const dsh = join(runner, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
  const env = {
    ...dshRouteEnvironment(config, 'guardian-route-secret'),
    CI: 'true', DSH_HOME: dshHome,
    PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
  };
  const invoke = (patchPath = overlay) => runCommand(dsh, ['--profile', 'headless', '--patch', patchPath, 'Reply briefly without tools.'], {
    cwd: temporaryRoot, timeoutMs: 90_000, env, secretValues: ['guardian-route-secret'], reject: false,
  });

  const success = await invoke();
  assert.equal(success.exitCode, 0, success.stderr);
  assert.ok(requests.length >= 1);
  assert.equal(requests[0].url, '/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer guardian-route-secret');
  assert.equal(JSON.parse(requests[0].body).model, 'guardian-custom-model');

  const observed = [];
  for (const status of [401, 'bad-model', 'not-found', 429, 503, 'timeout']) {
    responseStatus = status;
    const before = requests.length;
    const result = await invoke();
    assert.notEqual(result.exitCode, 0);
    assert.ok(requests.length > before, `DSH did not call the HTTP endpoint for ${status}`);
    const failure = classifyModelFailure(new GuardianError('COMMAND_FAILED', `${result.stdout}\n${result.stderr}`));
    const requestCount = requests.length - before;
    assert.ok(requestCount <= 2, `DSH exceeded the one-retry policy for ${status}: ${requestCount} requests`);
    observed.push({ status, requests: requestCount, code: failure.code, guardianStatus: failure.status });
  }
  assert.deepEqual(observed.map(item => item.code), [
    'MODEL_CREDENTIAL_REJECTED', 'MODEL_NOT_FOUND', 'MODEL_ENDPOINT_NOT_FOUND',
    'MODEL_RATE_LIMITED', 'MODEL_PROVIDER_5XX', 'MODEL_PROVIDER_TIMEOUT',
  ]);

  const unavailableServer = createServer();
  unavailableServer.listen(0, '127.0.0.1');
  await once(unavailableServer, 'listening');
  const unavailablePort = unavailableServer.address().port;
  unavailableServer.close();
  await once(unavailableServer, 'close');
  const unavailableConfig = structuredClone(config);
  unavailableConfig.credentials.base_url = `http://127.0.0.1:${unavailablePort}`;
  const unavailableOverlay = join(temporaryRoot, 'unavailable-route.yml');
  await writeFile(unavailableOverlay, stringify(dshRouteRows(unavailableConfig)));
  const unavailableResult = await invoke(unavailableOverlay);
  assert.notEqual(unavailableResult.exitCode, 0);
  const unavailableFailure = classifyModelFailure(new GuardianError('COMMAND_FAILED', `${unavailableResult.stdout}\n${unavailableResult.stderr}`));
  assert.equal(unavailableFailure.code, 'MODEL_PROVIDER_UNREACHABLE');

  const unregisteredConfig = structuredClone(config);
  unregisteredConfig.repair.provider = 'guardian-unregistered-provider';
  const unregisteredOverlay = join(temporaryRoot, 'unregistered-provider.yml');
  await writeFile(unregisteredOverlay, stringify(dshRouteRows(unregisteredConfig)));
  const beforeUnregistered = requests.length;
  const unregisteredResult = await invoke(unregisteredOverlay);
  assert.notEqual(unregisteredResult.exitCode, 0);
  assert.equal(requests.length, beforeUnregistered);
  const unregisteredFailure = classifyModelFailure(new GuardianError('COMMAND_FAILED', `${unregisteredResult.stdout}\n${unregisteredResult.stderr}`));
  assert.equal(unregisteredFailure.code, 'MODEL_PROVIDER_NOT_REGISTERED');

  const repairRepo = join(temporaryRoot, 'repair-repo');
  const repairOutput = join(temporaryRoot, 'repair-output');
  await mkdir(repairRepo);
  await writeFile(join(repairRepo, 'package.json'), '{"name":"guardian-route-fixture","version":"1.0.0"}\n');
  await writeFile(join(repairRepo, '.dsh-compat.yml'), stringify({
    schema: 1,
    repair: { dsh_version: '0.1.1-rc.2', start_policy: 'immediate', search: { enabled: false } },
    credentials: { api_key_env: 'GUARDIAN_CUSTOM_KEY', base_url: config.credentials.base_url },
    gates: { repository: [] },
  }));
  await writeFile(join(repairRepo, '.dsh-compat.lock.json'), '{"schema":1,"resetBudget":"N","verified":null,"campaigns":{}}\n');
  await runCommand('git', ['init', '-b', 'main'], { cwd: repairRepo });
  await runCommand('git', ['add', '.'], { cwd: repairRepo });
  await runCommand('git', ['-c', 'user.name=Guardian Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-m', 'probe fixture'], { cwd: repairRepo });
  // The report is an Actions artifact in production. Keep it outside the clean checkout for this probe.
  const externalFailurePath = join(temporaryRoot, 'repair-failure.json');
  await writeFile(externalFailurePath, JSON.stringify({
    status: 'BLOCKED',
    source: { commit: (await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repairRepo })).stdout.trim() },
    snapshotKey: 'route-probe-snapshot',
    candidate: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.2' }, plugin: { name: 'guardian-route-fixture' },
    error: { code: 'PLUGIN_ASSERTION_FAILED', message: 'controlled repair input' },
  }));
  responseStatus = 401;
  process.env.GUARDIAN_CUSTOM_KEY = 'guardian-route-secret';
  process.env.GUARDIAN_TRIGGER = 'workflow_dispatch';
  await assert.rejects(() => repairRepository({
    repoPath: repairRepo, failureReportPath: externalFailurePath, outputDirectory: repairOutput,
  }), { code: 'MODEL_CREDENTIAL_REJECTED' });
  const repairLock = JSON.parse(await readFile(join(repairOutput, 'blocked-lock.json'), 'utf8'));
  const repairCampaign = repairLock.campaigns['0.1.1-rc.2'];
  assert.equal(repairCampaign.status, 'BLOCKED_CONFIG');
  assert.equal(repairCampaign.automatic_repair_used, false);
  assert.equal(repairCampaign.attempts_used, 0);
  process.stdout.write(`${JSON.stringify({
    dsh: '0.1.1-rc.2', customRoute: {
      path: requests[0].url, authorizationMatched: true, model: 'guardian-custom-model', requests: requests.length,
    }, failures: observed,
    unreachable: { code: unavailableFailure.code, guardianStatus: unavailableFailure.status },
    unregisteredProvider: { code: unregisteredFailure.code, guardianStatus: unregisteredFailure.status, httpRequests: 0 },
    repair401: { status: repairCampaign.status, automaticRepairUsed: false, attemptsUsed: 0 },
  }, null, 2)}\n`);
} finally {
  server.close();
  await once(server, 'close').catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}

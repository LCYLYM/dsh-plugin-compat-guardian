import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve } from 'node:path';

import { stringify } from 'yaml';

import { estimateRouteCny, readDshTokenUsage } from './budget.js';
import { addUsage, budgetState, recordCampaign } from './campaign.js';
import { loadConfig, loadContract } from './config.js';
import { GuardianError } from './errors.js';
import { sha256 } from './hash.js';
import { runCommand, startService } from './process.js';
import { writeReport } from './report.js';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitReady(url, service) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (service.exited) throw new GuardianError('WEB_EXITED', 'candidate model smoke web process exited');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new GuardianError('WEB_TIMEOUT', 'candidate model smoke web process did not become ready');
}

async function rpc(baseUrl, method, payload) {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new GuardianError('MODEL_SMOKE_TRANSPORT', `DSH RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.rpcId !== rpcId || body.result?.ok !== true) {
    throw new GuardianError('MODEL_SMOKE_RPC', `DSH RPC ${method} failed: ${body.result?.error?.code ?? 'invalid-response'}`);
  }
  return body.result.value;
}

function mediaType(path) {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.gif$/i.test(path)) return 'image/gif';
  throw new GuardianError('FIXTURE_INVALID', `visual fixture must be PNG, JPEG, WebP, or GIF: ${path}`);
}

export async function resolveModelFixtures(repoPath, contract) {
  const root = await realpath(repoPath);
  const choices = contract.model_smoke.fixtures;
  const fixtures = [];
  const resolveOne = async item => {
    let data;
    let source;
    let name;
    let type;
    if (typeof item.path === 'string') {
      const path = await realpath(resolve(root, item.path));
      if (relative(root, path).startsWith('..')) throw new GuardianError('FIXTURE_ESCAPE', 'fixture resolves outside the plugin repository');
      data = await readFile(path);
      source = item.path;
      name = item.name ?? basename(path);
      type = item.media_type ?? mediaType(path);
    } else if (typeof item.url === 'string') {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
        throw new GuardianError('FIXTURE_URL_UNSAFE', 'download fixture must use a public credential-free HTTPS URL');
      }
      const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
      if (addresses.some(({ address }) => /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i.test(address)
        || /^172\.(?:1[6-9]|2\d|3[01])\./.test(address))) {
        throw new GuardianError('FIXTURE_URL_UNSAFE', 'download fixture resolved to a private address');
      }
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new GuardianError('FIXTURE_DOWNLOAD_FAILED', `fixture download returned HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > 10 * 1024 * 1024) throw new GuardianError('FIXTURE_INVALID', 'fixture download must be 1 byte to 10 MiB');
      source = url.href;
      name = item.name ?? basename(url.pathname) ?? 'fixture';
      type = item.media_type ?? response.headers.get('content-type')?.split(';', 1)[0] ?? mediaType(url.pathname);
    } else if (typeof item.data_base64 === 'string') {
      data = Buffer.from(item.data_base64, 'base64');
      source = 'generated:reviewed-base64';
      name = item.name ?? 'generated-fixture.png';
      type = item.media_type ?? mediaType(name);
    } else {
      throw new GuardianError('FIXTURE_INVALID', 'fixture needs path, public url, or reviewed data_base64');
    }
    return { source, name, mediaType: type, bytes: data.length, sha256: sha256(data), data: data.toString('base64') };
  };
  for (const item of choices) {
    try {
      fixtures.push(await resolveOne(item));
      if (contract.fixture_mode === 'agent-selected') break;
    } catch (error) {
      if (contract.fixture_mode !== 'agent-selected') throw error;
    }
  }
  if (fixtures.length === 0) throw new GuardianError('FIXTURE_INVALID', 'no reviewed fixture candidate could be resolved');
  return fixtures;
}

function overlay(config, sessions) {
  return `${stringify([
    { id: 'agent-default-model', config: { provider: config.repair.provider, model: config.repair.model } },
  ])}- id: session-persistence-jsonl\n  config:\n    root: ${JSON.stringify(sessions)}\n    compression: none\n`;
}

function finalText(events) {
  const assistants = events.filter(event => event.type === 'assistant/message');
  const content = assistants.at(-1)?.data?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(part => part.text ?? '').join('').trim();
  return '';
}

async function uploadThroughPlugin(baseUrl, sessionId, fixture, contract) {
  const upload = contract.model_smoke.plugin_upload;
  if (!upload) return { observed: false, promptSuffix: '' };
  const root = upload.endpoint_root.replace(/\/+$/, '');
  const metadata = await fetch(`${baseUrl}${root}/batches`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, files: [{ path: upload.path ?? fixture.name, size: fixture.bytes, type: fixture.mediaType }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (metadata.status !== 201) throw new GuardianError('MODEL_SMOKE_PLUGIN_UPLOAD_FAILED', `plugin batch creation returned HTTP ${metadata.status}`);
  const batch = await metadata.json();
  const bytes = Buffer.from(fixture.data, 'base64');
  const uploaded = await fetch(`${baseUrl}${root}/batches/${encodeURIComponent(batch.batchId)}/files/0`, {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploaded.ok) throw new GuardianError('MODEL_SMOKE_PLUGIN_UPLOAD_FAILED', `plugin file upload returned HTTP ${uploaded.status}`);
  const committed = await fetch(`${baseUrl}${root}/batches/${encodeURIComponent(batch.batchId)}/commit`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
  });
  if (!committed.ok) throw new GuardianError('MODEL_SMOKE_PLUGIN_UPLOAD_FAILED', `plugin commit returned HTTP ${committed.status}`);
  const result = await committed.json();
  if (result.ok !== true || !result.files?.[0]?.absolutePath) throw new GuardianError('MODEL_SMOKE_PLUGIN_UPLOAD_FAILED', 'plugin commit omitted the uploaded file evidence');
  return { observed: true, promptSuffix: ` The reviewed plugin also stored the same fixture at ${result.files[0].absolutePath}; inspect it if useful.` };
}

export async function runCandidateModelSmoke(options) {
  const repoPath = await realpath(resolve(options.repoPath));
  const outputDirectory = resolve(options.outputDirectory ?? '.guardian-output/model-smoke');
  const operationStarted = Date.now();
  await mkdir(outputDirectory, { recursive: true });
  const { config } = await loadConfig(repoPath);
  const { contract } = await loadContract(repoPath, config.smoke.contract);
  const baseLock = options.baseLockPath
    ? JSON.parse(await readFile(resolve(options.baseLockPath), 'utf8'))
    : JSON.parse(await readFile(resolve(repoPath, '.dsh-compat.lock.json'), 'utf8'));
  const previous = baseLock.campaigns?.[options.dshVersion];
  if (process.env.GUARDIAN_PENDING_PUBLICATION === 'true') {
    const report = { schema: 1, status: 'FROZEN', kind: 'model-smoke', candidate: { version: options.dshVersion }, error: { code: 'STATE_PUBLICATION_PENDING', message: 'campaign state PR is waiting for merge' } };
    await writeReport(report, outputDirectory);
    return report;
  }
  if (previous?.status === 'BLOCKED_EXTERNAL'
    && !['workflow_dispatch', 'push'].includes(process.env.GUARDIAN_TRIGGER ?? 'local')) {
    const report = { schema: 1, status: 'FROZEN', kind: 'model-smoke', candidate: { version: options.dshVersion }, error: { code: 'EXTERNAL_RECOVERY_SIGNAL_REQUIRED', message: 'schedule cannot retry a frozen external model-smoke failure' } };
    await writeReport(report, outputDirectory);
    return report;
  }
  if (contract.requires_model_turn === true && contract.model_turn_scope === 'differential' && options.singleRun !== true) {
    const baselineVersion = baseLock.verified?.dsh?.version;
    if (!baselineVersion) throw new GuardianError('MODEL_SMOKE_BASELINE_MISSING', 'differential model smoke requires a verified baseline DSH');
    try {
      const baselineReport = await runCandidateModelSmoke({
        ...options, dshVersion: baselineVersion, outputDirectory: join(outputDirectory, 'baseline'), singleRun: true,
      });
      const candidateReport = baselineVersion === options.dshVersion
        ? baselineReport
        : await runCandidateModelSmoke({
          ...options, outputDirectory: join(outputDirectory, 'candidate'), singleRun: true,
        });
      const baselineHashes = baselineReport.fixtures.map(item => item.sha256);
      const candidateHashes = candidateReport.fixtures.map(item => item.sha256);
      if (JSON.stringify(baselineHashes) !== JSON.stringify(candidateHashes)) {
        throw new GuardianError('FIXTURE_DRIFT', 'differential model smoke did not reuse identical fixture bytes');
      }
      const usage = baselineVersion === options.dshVersion
        ? candidateReport.usage
        : addUsage(baselineReport.usage, candidateReport.usage);
      const campaignUsage = addUsage(previous?.usage, usage);
      const estimatedCny = estimateRouteCny(campaignUsage, config.pricing, {
        provider: config.repair.provider, model: config.repair.model, base_url: config.credentials.base_url,
      });
      const activeMs = Number(previous?.active_ms ?? 0) + Date.now() - operationStarted;
      const state = budgetState({
        usage: campaignUsage, estimatedCny: estimatedCny.amount, activeMs,
        attemptsUsed: Number(previous?.attempts_used ?? 0),
      }, config.budget, config.repair.max_attempts);
      if (state.exhausted) throw new GuardianError('BUDGET_EXHAUSTED', `differential model smoke exhausted campaign budget: ${state.exhaustedBy.join(', ')}`);
      const report = {
        schema: 1, status: 'PASS', kind: 'model-smoke', candidate: { version: options.dshVersion },
        contract: { scope: 'differential', fixtureMode: contract.fixture_mode },
        fixtures: candidateReport.fixtures,
        evidence: {
          baseline: baselineReport.evidence,
          candidate: candidateReport.evidence,
          deduplicatedSameSnapshot: baselineVersion === options.dshVersion,
        },
        usage,
        budget: { usage: campaignUsage, estimatedCny, limits: config.budget, state },
        attempts: baselineReport.attempts + (baselineVersion === options.dshVersion ? 0 : candidateReport.attempts),
      };
      const nextLock = recordCampaign(baseLock, options.dshVersion, {
        ...(previous ?? {}), status: 'PASS', automatic_repair_used: previous?.automatic_repair_used === true,
        candidate_smoke: { status: 'PASS', scope: 'differential', evidence: report.evidence, fixtures: report.fixtures },
        usage: campaignUsage,
        estimated_cny: estimatedCny,
        active_ms: activeMs,
      });
      await Promise.all([
        writeReport(report, outputDirectory),
        writeFile(join(outputDirectory, 'verified-lock.json'), `${JSON.stringify(nextLock, null, 2)}\n`, { mode: 0o600 }),
      ]);
      return report;
    } catch (error) {
      const guardianError = error instanceof GuardianError ? error : new GuardianError('MODEL_SMOKE_UNEXPECTED', String(error));
      const external = ['MODEL_SMOKE_TRANSPORT', 'MODEL_SMOKE_RPC'].includes(guardianError.code);
      const blockedReport = { schema: 1, status: external ? 'BLOCKED_EXTERNAL' : 'BLOCKED', kind: 'model-smoke', candidate: { version: options.dshVersion }, error: { code: guardianError.code, message: guardianError.message } };
      const blockedLock = recordCampaign(baseLock, options.dshVersion, {
        ...(previous ?? {}), status: blockedReport.status,
        candidate_smoke: { status: blockedReport.status, scope: 'differential', error: blockedReport.error },
        automatic_repair_used: previous?.automatic_repair_used === true,
      });
      await Promise.all([
        writeReport(blockedReport, outputDirectory),
        writeFile(join(outputDirectory, 'blocked-lock.json'), `${JSON.stringify(blockedLock, null, 2)}\n`, { mode: 0o600 }),
      ]);
      throw guardianError;
    }
  }
  if (contract.requires_model_turn !== true) {
    const report = { schema: 1, status: 'NOOP', kind: 'model-smoke', candidate: { version: options.dshVersion } };
    await writeReport(report, outputDirectory);
    return report;
  }
  const key = process.env[config.credentials.api_key_env] ?? process.env.DEEPSEEK_API_KEY;
  let temporaryRoot;
  let service;
  let observedUsage;
  const smokeStarted = Date.now();
  try {
    if (!key) throw new GuardianError('MODEL_CREDENTIAL_MISSING', 'reviewed model smoke requires the configured repository Secret');
    const fixtures = await resolveModelFixtures(repoPath, contract);
    temporaryRoot = await mkdtemp(join(tmpdir(), 'guardian-model-smoke-'));
    const runner = join(temporaryRoot, 'runner');
    const dshHome = join(temporaryRoot, 'dsh-home');
    const sessions = join(dshHome, 'sessions');
    const pack = join(temporaryRoot, 'pack');
    await Promise.all([mkdir(runner), mkdir(dshHome), mkdir(pack)]);
    await writeFile(join(runner, 'package.json'), '{"private":true}\n');
    await runCommand('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${options.dshVersion}`], { cwd: runner, timeoutMs: 12 * 60_000, env: { ...process.env, CI: 'true' } });
    const dsh = join(runner, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    const packed = await runCommand('npm', ['pack', '--json', '--pack-destination', pack], { cwd: repoPath, timeoutMs: 10 * 60_000, env: { ...process.env, CI: 'true' } });
    const tarball = resolve(pack, JSON.parse(packed.stdout.slice(packed.stdout.indexOf('['), packed.stdout.lastIndexOf(']') + 1))[0].filename);
    const env = {
      ...process.env, CI: 'true', DSH_HOME: dshHome,
      PATH: `${join(runner, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
      [config.credentials.base_url_env]: config.credentials.base_url,
      [config.credentials.search_base_url_env]: config.credentials.search_base_url,
      [config.credentials.api_key_env]: key,
    };
    await runCommand(dsh, ['plugin', '--profile', config.plugin.profile, 'add', tarball], { cwd: repoPath, timeoutMs: 12 * 60_000, env, secretValues: [key] });
    const overlayPath = join(temporaryRoot, 'model-smoke.yml');
    await writeFile(overlayPath, overlay(config, sessions));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    service = startService(dsh, ['--profile', config.plugin.profile, '--patch', overlayPath, 'web', '--host', '127.0.0.1', '--port', String(port)], { cwd: repoPath, env, secretValues: [key] });
    await waitReady(baseUrl, service);
    let accepted;
    let events = [];
    let attempts = 0;
    let lastError;
    while (attempts < 2 && !accepted) {
      attempts += 1;
      try {
        const { sessionId } = await rpc(baseUrl, 'session.create', { cwd: repoPath });
        await rpc(baseUrl, 'session.selectModel', { sessionId, provider: config.repair.provider, model: config.repair.model });
        const pluginUpload = await uploadThroughPlugin(baseUrl, sessionId, fixtures[0], contract);
        await rpc(baseUrl, 'session.prompt', {
          sessionId, mode: 'queue', clientTimeZone: config.pricing.timezone,
          content: [{ type: 'text', text: `${contract.model_smoke.prompt}${pluginUpload.promptSuffix}` }, ...fixtures.map(item => ({ type: 'image', mediaType: item.mediaType, data: item.data, name: item.name }))],
        });
        for (let poll = 0; poll < 360; poll += 1) {
          const history = await rpc(baseUrl, 'session.history', { sessionId, maxMessages: 20 });
          events = history.events.map(entry => entry.event);
          if (events.some(event => event.type === 'turn/end')) break;
          await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
        }
        const types = new Set(events.map(event => event.type));
        const terminal = events.findLast(event => event.type === 'turn/end');
        if (terminal && /(?:timeout|timed out|\b429\b|HTTP\s*5\d\d|status\s*5\d\d)/i.test(JSON.stringify(terminal.data))) {
          throw new GuardianError('MODEL_SMOKE_TRANSPORT', 'provider returned a retryable timeout, 429, or 5xx failure');
        }
        const hasImage = events.some(event => event.type === 'user/message' && JSON.stringify(event.data).includes('image'));
        const missing = contract.model_smoke.required_event_types.filter(type => !types.has(type));
        if (!hasImage) throw new GuardianError('MODEL_SMOKE_IMAGE_MISSING', 'DSH history did not persist an image attachment reference');
        if (missing.length > 0) throw new GuardianError('MODEL_SMOKE_PLUGIN_NOT_OBSERVED', `required plugin events missing: ${missing.join(', ')}`);
        if (finalText(events) === '') throw new GuardianError('MODEL_SMOKE_EMPTY_RESULT', 'DSH received no non-empty assistant result');
        accepted = { eventTypes: [...types].sort(), finalResponseSha256: sha256(finalText(events)), imageObserved: true, pluginInputObserved: pluginUpload.observed || contract.model_smoke.plugin_upload === undefined };
      } catch (error) {
        lastError = error;
        if (!['MODEL_SMOKE_TRANSPORT', 'MODEL_SMOKE_RPC'].includes(error.code) || attempts >= 2) throw error;
      }
    }
    if (!accepted) throw lastError;
    const usage = await readDshTokenUsage(sessions);
    observedUsage = usage;
    const campaignUsage = addUsage(previous?.usage, usage);
    const estimatedCny = estimateRouteCny(campaignUsage, config.pricing, {
      provider: config.repair.provider, model: config.repair.model, base_url: config.credentials.base_url,
    });
    const activeMs = Number(previous?.active_ms ?? 0) + Date.now() - smokeStarted;
    const state = budgetState({
      usage: campaignUsage, estimatedCny: estimatedCny.amount, activeMs,
      attemptsUsed: Number(previous?.attempts_used ?? 0),
    }, config.budget, config.repair.max_attempts);
    if (state.exhausted) throw new GuardianError('BUDGET_EXHAUSTED', `candidate model smoke exhausted campaign budget: ${state.exhaustedBy.join(', ')}`);
    const report = {
      schema: 1, status: 'PASS', kind: 'model-smoke', candidate: { version: options.dshVersion },
      contract: { scope: contract.model_turn_scope, fixtureMode: contract.fixture_mode },
      fixtures: fixtures.map(({ source, name, mediaType: type, bytes, sha256: hash }) => ({ source, name, mediaType: type, bytes, sha256: hash })),
      evidence: accepted, usage, attempts,
      budget: { usage: campaignUsage, estimatedCny, limits: config.budget, state },
    };
    const nextLock = recordCampaign(baseLock, options.dshVersion, {
      ...(previous ?? {}),
      status: 'PASS',
      candidate_smoke: { status: 'PASS', attempts, fixtures: report.fixtures, evidence: accepted },
      usage: campaignUsage,
      estimated_cny: estimatedCny,
      active_ms: activeMs,
      automatic_repair_used: previous?.automatic_repair_used === true,
    });
    await writeFile(join(outputDirectory, 'verified-lock.json'), `${JSON.stringify(nextLock, null, 2)}\n`, { mode: 0o600 });
    await writeReport(report, outputDirectory);
    return report;
  } catch (error) {
    const guardianError = error instanceof GuardianError
      ? error
      : new GuardianError('MODEL_SMOKE_UNEXPECTED', error instanceof Error ? error.message : String(error));
    let safeMessage = guardianError.message.replaceAll(repoPath, '<REPOSITORY>');
    if (temporaryRoot) safeMessage = safeMessage.replaceAll(temporaryRoot, '<MODEL_SMOKE_TEMP>');
    const external = ['MODEL_SMOKE_TRANSPORT', 'MODEL_SMOKE_RPC'].includes(guardianError.code);
    const blockedReport = {
      schema: 1,
      status: external ? 'BLOCKED_EXTERNAL' : 'BLOCKED',
      kind: 'model-smoke',
      candidate: { version: options.dshVersion },
      error: { code: guardianError.code, message: safeMessage },
    };
    const blockedLock = recordCampaign(baseLock, options.dshVersion, {
      ...(previous ?? {}),
      status: external ? 'BLOCKED_EXTERNAL' : 'BLOCKED',
      candidate_smoke: { status: blockedReport.status, error: blockedReport.error },
      usage: addUsage(previous?.usage, observedUsage),
      active_ms: Number(previous?.active_ms ?? 0) + Date.now() - smokeStarted,
      automatic_repair_used: previous?.automatic_repair_used === true,
    });
    await Promise.all([
      writeReport(blockedReport, outputDirectory),
      writeFile(join(outputDirectory, 'blocked-lock.json'), `${JSON.stringify(blockedLock, null, 2)}\n`, { mode: 0o600 }),
    ]);
    throw guardianError;
  } finally {
    if (service) await service.stop().catch(() => undefined);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

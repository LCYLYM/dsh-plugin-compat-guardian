import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve, sep } from 'node:path';

import { loadConfig, loadContract } from './config.js';
import { CommandError, GuardianError } from './errors.js';
import { objectHash, sha256, sha256File } from './hash.js';
import { runCommand, shellCommand, startService } from './process.js';
import { resolveRegistrySnapshot } from './registry.js';
import { actionsReportUrl, readLock, writeLockAtomic, writeReport } from './report.js';
import { packageManagerInstallArgs, resolveRuntime } from './runtime.js';

function now() {
  return new Date().toISOString();
}

function sanitizeOutput(value, replacements) {
  let text = String(value ?? '');
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text;
}

export function trackedTreeDigest(lsFilesOutput, excludedPaths = []) {
  const excluded = new Set(excludedPaths.map(path => path.split(sep).join('/')));
  const entries = lsFilesOutput
    .split('\0')
    .filter(Boolean)
    .filter(entry => {
      const tab = entry.indexOf('\t');
      const path = tab === -1 ? '' : entry.slice(tab + 1);
      return !excluded.has(path);
    })
    .sort();
  return objectHash(entries);
}

export function runtimeSnapshotIdentity(runtime) {
  return {
    node: runtime.node,
    packageManager: runtime.packageManager,
    runner: {
      configuredLabel: runtime.runner.configuredLabel,
      os: runtime.runner.os,
      arch: runtime.runner.arch,
      githubActions: runtime.runner.githubActions,
    },
  };
}

function stepFromCommand(name, result, replacements) {
  const ok = result.exitCode === 0 && !result.timedOut;
  const step = {
    name,
    ok,
    command: sanitizeOutput(result.displayCommand, replacements),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stdoutSha256: sha256(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
    stderrSha256: sha256(result.stderr),
  };
  if (!ok) {
    step.stdout = sanitizeOutput(result.stdout, replacements);
    step.stderr = sanitizeOutput(result.stderr, replacements);
  }
  return step;
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForHttp(url, service, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    if (service.exited) throw new GuardianError('WEB_EXITED', 'dsh web exited before becoming ready', service.snapshot());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return { status: response.status, durationMs: Date.now() - started };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new GuardianError('WEB_TIMEOUT', `dsh web did not become ready: ${lastError?.message ?? 'timeout'}`);
}

function isSubset(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length <= actual.length
      && expected.every((item, index) => isSubset(item, actual[index]));
  }
  return actual !== null && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => isSubset(value, actual[key]));
}

async function executeAssertion(baseUrl, assertion) {
  const response = await fetch(new URL(assertion.path, baseUrl), {
    method: assertion.method ?? 'GET',
    headers: assertion.headers,
    body: assertion.body === undefined ? undefined : JSON.stringify(assertion.body),
    signal: AbortSignal.timeout((assertion.timeout_seconds ?? 10) * 1000),
  });
  const text = await response.text();
  const expectedStatus = assertion.status ?? 200;
  if (response.status !== expectedStatus) {
    throw new GuardianError('SMOKE_ASSERTION_FAILED', `${assertion.id ?? assertion.path}: expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  if (assertion.json_subset !== undefined) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new GuardianError('SMOKE_ASSERTION_FAILED', `${assertion.id ?? assertion.path}: response was not JSON`);
    }
    if (!isSubset(assertion.json_subset, body)) {
      throw new GuardianError('SMOKE_ASSERTION_FAILED', `${assertion.id ?? assertion.path}: JSON subset did not match`);
    }
  }
  if (assertion.body_includes !== undefined && !text.includes(assertion.body_includes)) {
    throw new GuardianError('SMOKE_ASSERTION_FAILED', `${assertion.id ?? assertion.path}: response did not include required text`);
  }
  return { id: assertion.id ?? assertion.path, status: response.status };
}

async function parsePackResult(stdout, packDirectory) {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1) throw new GuardianError('PACK_INVALID', 'npm pack did not return JSON');
  const rows = JSON.parse(stdout.slice(start, end + 1));
  const filename = rows[0]?.filename;
  if (typeof filename !== 'string') throw new GuardianError('PACK_INVALID', 'npm pack JSON omitted filename');
  return resolve(packDirectory, basename(filename));
}

export async function verifyRepository(options) {
  const startedAt = now();
  const steps = [];
  let temporaryRoot;
  let service;
  let report;
  const repoPath = await realpath(resolve(options.repoPath ?? '.'));
  const outputDirectory = resolve(options.outputDirectory ?? '.guardian-output');
  const replacements = [[repoPath, '<REPOSITORY>']];
  const addCommandStep = async (name, command, args, commandOptions = {}) => {
    try {
      const result = await runCommand(command, args, commandOptions);
      steps.push(stepFromCommand(name, result, replacements));
      return result;
    } catch (error) {
      if (error instanceof CommandError) steps.push(stepFromCommand(name, error.result, replacements));
      throw error;
    }
  };
  const addShellStep = async (name, command, commandOptions = {}) => {
    try {
      const result = await shellCommand(command, commandOptions);
      steps.push(stepFromCommand(name, result, replacements));
      return result;
    } catch (error) {
      if (error instanceof CommandError) steps.push(stepFromCommand(name, error.result, replacements));
      throw error;
    }
  };

  let source;
  let candidate;
  let runtime;
  let plugin;
  let snapshotKey;
  let lockPath;
  let baseline;
  let onboarding = false;
  let modelSmokeRequired = false;
  try {
    const { config } = await loadConfig(repoPath, options.configPath);
    if (options.dshVersion) config.watch.channel = options.dshVersion;
    const { contract, path: contractPath } = await loadContract(repoPath, options.contractPath ?? config.smoke.contract);
    modelSmokeRequired = contract.requires_model_turn === true;
    runtime = await resolveRuntime(repoPath, config);
    steps.push({ name: 'resolve-runtime', ok: true, durationMs: 0 });

    const commit = (await addCommandStep('read-source-commit', 'git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    const status = (await addCommandStep('check-clean-source', 'git', ['status', '--porcelain'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    if (status !== '' && !options.allowDirty) throw new GuardianError('DIRTY_SOURCE', 'repository must be clean before compatibility verification');
    const tracked = await addCommandStep('read-tracked-source-tree', 'git', ['ls-files', '-s', '-z'], {
      cwd: repoPath,
      timeoutMs: 30_000,
      outputLimit: 16 * 1024 * 1024,
    });
    const lockRelative = relative(repoPath, resolve(repoPath, options.lockPath ?? '.dsh-compat.lock.json'));
    source = {
      commit,
      treeDigest: trackedTreeDigest(tracked.stdout, [lockRelative]),
      dirty: status !== '',
    };

    candidate = await resolveRegistrySnapshot({
      registry: config.watch.registry,
      packageName: config.watch.package,
      spec: config.watch.channel,
    });
    steps.push({ name: 'resolve-registry-snapshot', ok: true, durationMs: 0 });

    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-guardian-'));
    replacements.push([temporaryRoot, '<GUARDIAN_TEMP>']);
    const runnerDirectory = join(temporaryRoot, 'candidate-runner');
    const dshHome = join(temporaryRoot, 'dsh-home');
    const packDirectory = join(temporaryRoot, 'plugin-pack');
    await Promise.all([mkdir(runnerDirectory, { recursive: true }), mkdir(dshHome), mkdir(packDirectory)]);
    await writeFile(join(runnerDirectory, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    await addCommandStep(
      'install-candidate-dsh',
      'pnpm',
      ['add', '--save-exact', `${candidate.package}@${candidate.version}`],
      { cwd: runnerDirectory, timeoutMs: options.installTimeoutMs ?? 12 * 60 * 1000, env: { ...process.env, CI: 'true' } },
    );
    const dshBinary = join(runnerDirectory, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    const installedVersion = (await addCommandStep('confirm-candidate-version', dshBinary, ['--version'], { cwd: runnerDirectory, timeoutMs: 30_000 })).stdout.trim();
    if (installedVersion !== candidate.version) {
      throw new GuardianError('CANDIDATE_DRIFT', `installed DSH ${installedVersion}, expected ${candidate.version}`);
    }
    const graphLock = join(runnerDirectory, 'pnpm-lock.yaml');
    candidate.graphDigest = await sha256File(graphLock);
    candidate.graphSource = 'pnpm-lock.yaml';

    const manifest = JSON.parse(await readFile(join(repoPath, config.plugin.package_json), 'utf8'));
    if (typeof manifest.name !== 'string') throw new GuardianError('PACKAGE_INVALID', 'plugin package.json must have a name');
    const contractSha256 = await sha256File(contractPath);
    plugin = { name: manifest.name, version: manifest.version ?? null, contractSha256 };
    snapshotKey = objectHash({
      sourceTreeDigest: source.treeDigest,
      candidate: {
        package: candidate.package,
        version: candidate.version,
        integrity: candidate.integrity,
        graphDigest: candidate.graphDigest,
      },
      runtime: runtimeSnapshotIdentity(runtime),
      contractSha256,
    });
    lockPath = resolve(repoPath, options.lockPath ?? '.dsh-compat.lock.json');
    const existingLock = await readLock(lockPath);
    if (!options.skipNoop && existingLock.verified?.snapshot_key === snapshotKey) {
      report = {
        schema: 1,
        status: 'NOOP',
        startedAt,
        finishedAt: now(),
        source,
        candidate,
        runtime,
        plugin,
        snapshotKey,
        reportUrl: existingLock.verified.report_url ?? null,
        modelSmokeRequired,
        repairEligible: false,
        steps,
      };
      await writeReport(report, outputDirectory);
      return report;
    }

    if (!options.skipDifferential) {
      const baselineVersion = existingLock.verified?.dsh?.version ?? config.repair.dsh_version;
      onboarding = existingLock.verified?.dsh?.version === undefined;
      if (baselineVersion === candidate.version) {
        const sameRuntime = existingLock.verified?.runtime
          ? objectHash(runtimeSnapshotIdentity(existingLock.verified.runtime)) === objectHash(runtimeSnapshotIdentity(runtime))
          : false;
        const sameInputs = existingLock.verified?.source_tree_digest === source.treeDigest
          && existingLock.verified?.plugin?.contract_sha256 === plugin.contractSha256
          && sameRuntime;
        const graphChanged = existingLock.verified?.dsh?.graph_digest
          && existingLock.verified.dsh.graph_digest !== candidate.graphDigest;
        baseline = graphChanged && sameInputs
          ? { status: 'HISTORICAL_PASS', version: baselineVersion, graphDigest: existingLock.verified.dsh.graph_digest }
          : { status: 'SAME_SNAPSHOT', version: baselineVersion };
      } else {
        try {
          const baselineReport = await verifyRepository({
            ...options,
            dshVersion: baselineVersion,
            outputDirectory: join(outputDirectory, 'baseline'),
            skipDifferential: true,
            skipNoop: true,
            writeLock: false,
          });
          baseline = {
            status: baselineReport.status,
            version: baselineReport.candidate.version,
            integrity: baselineReport.candidate.integrity,
            graphDigest: baselineReport.candidate.graphDigest,
            snapshotKey: baselineReport.snapshotKey,
          };
        } catch (error) {
          const baselineReport = error?.report;
          const code = onboarding ? 'ONBOARDING_BLOCKED' : 'BASELINE_FAILED';
          throw new GuardianError(
            code,
            `reference DSH ${baselineVersion} did not pass the same gate: ${baselineReport?.error?.code ?? error.code ?? 'UNKNOWN'}`,
            { baseline: baselineReport },
          );
        }
      }
    }

    await addCommandStep('install-repository-dependencies', runtime.packageManager.name, packageManagerInstallArgs(runtime.packageManager), {
      cwd: repoPath,
      timeoutMs: options.installTimeoutMs ?? 12 * 60 * 1000,
      env: { ...process.env, CI: 'true' },
    });
    for (const [index, command] of config.gates.repository.entries()) {
      await addShellStep(`repository-gate-${index + 1}`, command, {
        cwd: repoPath,
        timeoutMs: options.gateTimeoutMs ?? 10 * 60 * 1000,
        env: { ...process.env, CI: 'true' },
      });
    }
    if (manifest.scripts?.build) {
      const trackedBuildInputs = (await addCommandStep('discover-build-inputs', 'git', ['ls-files', 'src'], {
        cwd: repoPath, timeoutMs: 30_000,
      })).stdout.trim();
      const trackedBuildOutputs = (await addCommandStep('discover-build-outputs', 'git', ['ls-files', 'lib', 'dist'], {
        cwd: repoPath, timeoutMs: 30_000,
      })).stdout.trim();
      if (trackedBuildInputs !== '' && trackedBuildOutputs !== '') {
        await addCommandStep('rebuild-tracked-output', runtime.packageManager.name, ['run', 'build'], {
          cwd: repoPath,
          timeoutMs: options.gateTimeoutMs ?? 10 * 60 * 1000,
          env: { ...process.env, CI: 'true' },
        });
        const dirtyBuildOutputs = (await addCommandStep('compare-rebuilt-output', 'git', ['diff', '--name-only', '--', 'lib', 'dist'], {
          cwd: repoPath, timeoutMs: 30_000,
        })).stdout.trim();
        if (dirtyBuildOutputs !== '') {
          throw new GuardianError('BUILD_NOT_REPRODUCIBLE', `tracked build output differs after a clean rebuild: ${dirtyBuildOutputs.split('\n').join(', ')}`);
        }
      }
    }
    const packed = await addCommandStep(
      'pack-plugin',
      'npm',
      ['pack', '--json', '--pack-destination', packDirectory],
      { cwd: repoPath, timeoutMs: options.gateTimeoutMs ?? 10 * 60 * 1000, env: { ...process.env, CI: 'true' } },
    );
    const tarballPath = await parsePackResult(packed.stdout, packDirectory);
    plugin.tarballSha256 = await sha256File(tarballPath);

    const candidateEnv = {
      ...process.env,
      CI: 'true',
      DSH_HOME: dshHome,
      PATH: `${join(runnerDirectory, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
    };
    await addCommandStep(
      'install-plugin-into-profile',
      dshBinary,
      ['plugin', '--profile', config.plugin.profile, 'add', tarballPath],
      { cwd: repoPath, env: candidateEnv, timeoutMs: options.installTimeoutMs ?? 12 * 60 * 1000 },
    );
    const dump = await addCommandStep(
      'dump-profile-with-plugin',
      dshBinary,
      ['--profile', config.plugin.profile, '--dump-config'],
      { cwd: repoPath, env: candidateEnv, timeoutMs: 2 * 60 * 1000 },
    );
    if (!dump.stdout.includes(plugin.name)) {
      throw new GuardianError('PLUGIN_NOT_ACTIVATED', `dump-config does not contain ${plugin.name}`);
    }

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    service = startService(dshBinary, ['web', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: repoPath,
      env: candidateEnv,
    });
    const webStarted = Date.now();
    await waitForHttp(new URL(contract.web?.ready?.path ?? '/', baseUrl), service, (contract.web?.ready?.timeout_seconds ?? 120) * 1000);
    steps.push({ name: 'start-real-dsh-web', ok: true, durationMs: Date.now() - webStarted });

    const assertionStarted = Date.now();
    const assertionResults = [];
    for (const assertion of contract.web.assertions) assertionResults.push(await executeAssertion(baseUrl, assertion));
    steps.push({ name: 'plugin-specific-smoke', ok: true, durationMs: Date.now() - assertionStarted, assertions: assertionResults });

    const stopped = await service.stop();
    service = undefined;
    steps.push({
      name: 'stop-real-dsh-web',
      ok: stopped.exitCode === 0 || stopped.signal === 'SIGTERM',
      durationMs: stopped.durationMs,
      stdoutBytes: Buffer.byteLength(stopped.stdout),
      stdoutSha256: sha256(stopped.stdout),
      stderrBytes: Buffer.byteLength(stopped.stderr),
      stderrSha256: sha256(stopped.stderr),
    });

    await addCommandStep(
      'remove-plugin-from-profile',
      dshBinary,
      ['plugin', '--profile', config.plugin.profile, 'remove', plugin.name],
      { cwd: repoPath, env: candidateEnv, timeoutMs: options.installTimeoutMs ?? 12 * 60 * 1000 },
    );
    const cleanDump = await addCommandStep(
      'dump-profile-after-remove',
      dshBinary,
      ['--profile', config.plugin.profile, '--dump-config'],
      { cwd: repoPath, env: candidateEnv, timeoutMs: 2 * 60 * 1000 },
    );
    if (cleanDump.stdout.includes(plugin.name)) {
      throw new GuardianError('PLUGIN_REMOVE_FAILED', `dump-config still contains ${plugin.name} after remove`);
    }

    const reportUrl = actionsReportUrl();
    report = {
      schema: 1,
      status: 'PASS',
      startedAt,
      finishedAt: now(),
      source,
      candidate,
      runtime,
      plugin,
      snapshotKey,
      reportUrl,
      modelSmokeRequired,
      repairEligible: false,
      baseline,
      steps,
    };
    await writeReport(report, outputDirectory);
    const durableLock = await readLock(lockPath);
    if (options.writeLock !== false) await writeLockAtomic(lockPath, {
      schema: 1,
      resetBudget: 'N',
      verified: {
        snapshot_key: snapshotKey,
        source_commit: source.commit,
        source_tree_digest: source.treeDigest,
        dsh: {
          package: candidate.package,
          version: candidate.version,
          integrity: candidate.integrity,
          graph_digest: candidate.graphDigest,
        },
        plugin: {
          package: plugin.name,
          version: plugin.version,
          tarball_sha256: plugin.tarballSha256,
          contract_sha256: plugin.contractSha256,
        },
        runtime,
        verified_at: report.finishedAt,
        report_url: reportUrl,
      },
      campaigns: durableLock.campaigns ?? {},
    });
    return report;
  } catch (error) {
    if (service !== undefined) {
      const stopped = await service.stop().catch(() => undefined);
      if (stopped) steps.push({
        name: 'stop-real-dsh-web-after-failure',
        ok: true,
        durationMs: stopped.durationMs,
        stdoutBytes: Buffer.byteLength(stopped.stdout),
        stdoutSha256: sha256(stopped.stdout),
        stderrBytes: Buffer.byteLength(stopped.stderr),
        stderrSha256: sha256(stopped.stderr),
      });
    }
    let guardianError = error instanceof GuardianError
      ? error
      : new GuardianError('UNEXPECTED', error instanceof Error ? error.message : String(error));
    if (onboarding && baseline?.status === 'SAME_SNAPSHOT' && !['ONBOARDING_BLOCKED', 'BASELINE_FAILED'].includes(guardianError.code)) {
      guardianError = new GuardianError('ONBOARDING_BLOCKED', `initial reference DSH failed: ${guardianError.code}`, { cause: guardianError.code });
    }
    report = {
      schema: 1,
      status: 'BLOCKED',
      startedAt,
      finishedAt: now(),
      source,
      candidate,
      runtime,
      plugin,
      snapshotKey,
      reportUrl: actionsReportUrl(),
      modelSmokeRequired,
      repairEligible: ['PASS', 'HISTORICAL_PASS'].includes(baseline?.status) && !onboarding,
      baseline,
      steps,
      error: { code: guardianError.code, message: sanitizeOutput(guardianError.message, replacements) },
    };
    await writeReport(report, outputDirectory);
    guardianError.report = report;
    throw guardianError;
  } finally {
    if (temporaryRoot && !options.keepTemp) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

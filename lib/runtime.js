import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import semver from 'semver';

import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

async function optionalText(path) {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function packageJson(repoPath) {
  try {
    return JSON.parse(await readFile(resolve(repoPath, 'package.json'), 'utf8'));
  } catch (error) {
    throw new GuardianError('PACKAGE_INVALID', `cannot read package.json: ${error.message}`);
  }
}

function exactishRange(value) {
  const trimmed = value?.trim().replace(/^v/, '');
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return `>=${trimmed}.0.0 <${Number(trimmed) + 1}.0.0`;
  if (/^\d+\.\d+$/.test(trimmed)) {
    const [major, minor] = trimmed.split('.').map(Number);
    return `>=${major}.${minor}.0 <${major}.${minor + 1}.0`;
  }
  if (semver.valid(trimmed)) return trimmed;
  if (semver.validRange(trimmed)) return trimmed;
  throw new GuardianError('RUNTIME_UNSUPPORTED', `unsupported Node declaration ${JSON.stringify(value)}`);
}

export async function resolveNodeRuntime(repoPath, requested = 'auto') {
  const manifest = await packageJson(repoPath);
  const nodeVersion = await optionalText(resolve(repoPath, '.node-version'));
  const nvmrc = await optionalText(resolve(repoPath, '.nvmrc'));
  const engines = typeof manifest.engines?.node === 'string' ? manifest.engines.node.trim() : undefined;
  const declarations = [
    ['.node-version', nodeVersion],
    ['.nvmrc', nvmrc],
    ['package.json#engines.node', engines],
  ].filter(([, value]) => value !== undefined);

  if (requested !== 'auto') declarations.unshift(['config.runtime.node', String(requested)]);
  const ranges = declarations.map(([source, value]) => [source, value, exactishRange(value)]);
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (!semver.intersects(ranges[left][2], ranges[right][2])) {
        throw new GuardianError(
          'RUNTIME_CONFLICT',
          `Node declarations conflict: ${ranges[left][0]}=${ranges[left][1]} and ${ranges[right][0]}=${ranges[right][1]}`,
        );
      }
    }
  }
  const effectiveRange = ranges[0]?.[2] ?? '>=24.0.0 <25.0.0';
  const exactVersion = process.versions.node;
  if (!ranges.every(([, , range]) => semver.satisfies(exactVersion, range))) {
    throw new GuardianError(
      'RUNTIME_MISMATCH',
      `current Node ${exactVersion} does not satisfy ${ranges.map(([source, value]) => `${source}=${value}`).join(', ')}`,
    );
  }
  return {
    exactVersion,
    effectiveRange,
    source: ranges[0]?.[0] ?? 'fallback-node-24-lts',
    declarations: Object.fromEntries(declarations),
  };
}

const LOCKFILES = new Map([
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]);

export async function resolvePackageManager(repoPath, requested = 'auto') {
  const manifest = await packageJson(repoPath);
  const declared = typeof manifest.packageManager === 'string'
    ? manifest.packageManager.split('@', 1)[0]
    : undefined;
  const presentLocks = [];
  for (const [file, manager] of LOCKFILES) {
    if (await optionalText(resolve(repoPath, file)) !== undefined) presentLocks.push({ file, manager });
  }
  const lockManagers = [...new Set(presentLocks.map(item => item.manager))];
  if (lockManagers.length > 1) {
    throw new GuardianError('PACKAGE_MANAGER_CONFLICT', `conflicting lockfiles: ${presentLocks.map(item => item.file).join(', ')}`);
  }
  const configured = requested === 'auto' ? undefined : String(requested);
  const candidates = [configured, declared, lockManagers[0]].filter(Boolean);
  if (new Set(candidates).size > 1) {
    throw new GuardianError(
      'PACKAGE_MANAGER_CONFLICT',
      `package manager declarations conflict: ${candidates.join(', ')}`,
    );
  }
  const name = candidates[0] ?? 'npm';
  if (name === 'bun') throw new GuardianError('BLOCKED_UNSUPPORTED', 'Bun repositories are not supported in V1');
  if (!['npm', 'pnpm', 'yarn'].includes(name)) {
    throw new GuardianError('BLOCKED_UNSUPPORTED', `package manager ${name} is not supported in V1`);
  }
  const version = (await runCommand(name, ['--version'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
  return {
    name,
    exactVersion: version,
    source: configured ? 'config.runtime.package_manager' : declared ? 'package.json#packageManager' : presentLocks[0]?.file ?? 'fallback-npm',
    lockfiles: presentLocks.map(item => item.file),
  };
}

export async function resolveRuntime(repoPath, config) {
  const [node, packageManager] = await Promise.all([
    resolveNodeRuntime(repoPath, config.runtime.node),
    resolvePackageManager(repoPath, config.runtime.package_manager),
  ]);
  return {
    node,
    packageManager,
    runner: {
      configuredLabel: config.runtime.runner,
      actualLabel: process.env.RUNNER_NAME ?? 'local',
      os: process.env.RUNNER_OS ?? process.platform,
      arch: process.arch,
      githubActions: process.env.GITHUB_ACTIONS === 'true',
    },
  };
}

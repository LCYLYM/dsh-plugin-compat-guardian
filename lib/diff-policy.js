import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import semver from 'semver';

import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);

function dependencyMap(manifest = {}) {
  const result = new Map();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) result.set(`${section}:${name}`, { section, name, version });
  }
  return result;
}

function major(value) {
  const version = semver.minVersion(value);
  return version?.major;
}

export function classifyManifestChanges(before = {}, after = {}) {
  const forceReview = [];
  const reject = [];
  const beforeDependencies = dependencyMap(before);
  const afterDependencies = dependencyMap(after);
  for (const key of new Set([...beforeDependencies.keys(), ...afterDependencies.keys()])) {
    const left = beforeDependencies.get(key);
    const right = afterDependencies.get(key);
    if (left?.version === right?.version) continue;
    const name = left?.name ?? right.name;
    if (!/(?:deepseek|\bdsh\b)/i.test(name)) {
      reject.push(`unrelated dependency changed: ${name}`);
      continue;
    }
    if (!left || !right) forceReview.push(`dependency ${left ? 'removed' : 'added'}: ${name}`);
    else if (major(left.version) !== undefined && major(right.version) !== undefined && major(left.version) !== major(right.version)) {
      forceReview.push(`dependency major changed: ${name}`);
    }
  }
  if (before.packageManager !== after.packageManager) reject.push('package manager declaration changed');
  if (before.scripts?.test !== after.scripts?.test) forceReview.push('package test command changed');
  for (const name of ['preinstall', 'install', 'postinstall']) {
    if (before.scripts?.[name] !== after.scripts?.[name]) forceReview.push(`install lifecycle script changed: ${name}`);
  }
  return { forceReview, reject };
}

export function diffStatistics(numstat = '') {
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let files = 0;
  for (const line of numstat.trim().split('\n').filter(Boolean)) {
    const [added, deleted] = line.split('\t');
    files += 1;
    if (added === '-' || deleted === '-') binaryFiles += 1;
    else {
      additions += Number(added);
      deletions += Number(deleted);
    }
  }
  return { files, additions, deletions, binaryFiles };
}

export async function classifyRepairDiff(repoPath, changedPaths, numstat) {
  const forceReview = [];
  const reject = [];
  const testPaths = changedPaths.filter(path => /(^|\/)(?:test|tests|__tests__)(\/|$)|(?:^|\/)(?:vitest|jest|playwright|cypress)\.config\.[^/]+$/i.test(path));
  if (testPaths.length > 0) forceReview.push(...testPaths.map(path => `test surface changed: ${path}`));

  const status = (await runCommand('git', ['diff', '--cached', '--name-status'], { cwd: repoPath, timeoutMs: 30_000 })).stdout;
  const lockChanges = status.trim().split('\n').filter(Boolean)
    .map(line => ({ state: line.split('\t')[0], path: line.split('\t').at(-1) }))
    .filter(item => LOCKFILES.has(item.path));
  if (lockChanges.some(item => /^[AD]/.test(item.state))) reject.push('package manager lockfile added or removed');

  const after = JSON.parse(await readFile(resolve(repoPath, 'package.json'), 'utf8'));
  if (after.scripts?.build && changedPaths.some(path => /^(?:lib|dist)\//.test(path))) {
    const trackedSource = (await runCommand('git', ['ls-files', 'src'], { cwd: repoPath, timeoutMs: 30_000 })).stdout.trim();
    if (trackedSource !== '' && !changedPaths.some(path => path.startsWith('src/'))) {
      reject.push('tracked build output changed without its source');
    }
  }
  if (changedPaths.includes('package.json')) {
    let before;
    try {
      const text = (await runCommand('git', ['show', 'HEAD:package.json'], { cwd: repoPath, timeoutMs: 30_000 })).stdout;
      before = JSON.parse(text);
    } catch (error) {
      throw new GuardianError('DIFF_POLICY_INVALID', `cannot read base package.json: ${error.message}`);
    }
    const manifest = classifyManifestChanges(before, after);
    forceReview.push(...manifest.forceReview);
    reject.push(...manifest.reject);
  }
  if (reject.length > 0) throw new GuardianError('REPAIR_DIFF_REJECTED', reject.join('; '));
  return {
    disposition: forceReview.length > 0 ? 'pull-request' : 'configured',
    forceReview,
    statistics: diffStatistics(numstat),
  };
}

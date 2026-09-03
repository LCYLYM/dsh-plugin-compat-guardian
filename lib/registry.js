import { GuardianError } from './errors.js';
import semver from 'semver';

const RELEASE_TAG_PATTERN = /^[A-Za-z0-9._-]+$/;

async function fetchJson(url, timeoutMs, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/vnd.github+json', ...headers },
    });
  } catch (error) {
    throw new GuardianError('GITHUB_RELEASE_UNAVAILABLE', `cannot query GitHub release metadata: ${error.message}`);
  }
  if (!response.ok) throw new GuardianError('GITHUB_RELEASE_UNAVAILABLE', `GitHub API returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new GuardianError('GITHUB_RELEASE_INVALID', 'GitHub API returned invalid JSON');
  }
}

function repositoryPath(repository) {
  if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new GuardianError('CONFIG_INVALID', 'watch.github_repository must be owner/repository');
  }
  return repository;
}

function releaseVersion(tagName, tagPrefix) {
  if (typeof tagName !== 'string' || !tagName.startsWith(tagPrefix)) return null;
  const version = tagName.slice(tagPrefix.length);
  return semver.valid(version) ? version : null;
}

async function tagCommit({ apiBase, repository, tagName, targetCommitish, timeoutMs }) {
  if (/^[0-9a-f]{40}$/i.test(String(targetCommitish ?? ''))) return targetCommitish;
  const ref = await fetchJson(
    `${apiBase.replace(/\/$/, '')}/repos/${repository}/git/ref/tags/${encodeURIComponent(tagName)}`,
    timeoutMs,
  );
  const object = ref?.object;
  if (object?.type === 'commit' && /^[0-9a-f]{40}$/i.test(object.sha)) return object.sha;
  if (object?.type === 'tag' && /^[0-9a-f]{40}$/i.test(object.sha)) {
    const annotated = await fetchJson(
      `${apiBase.replace(/\/$/, '')}/repos/${repository}/git/tags/${object.sha}`,
      timeoutMs,
    );
    if (annotated?.object?.type === 'commit' && /^[0-9a-f]{40}$/i.test(annotated.object.sha)) return annotated.object.sha;
  }
  throw new GuardianError('GITHUB_RELEASE_INVALID', `cannot resolve commit for GitHub tag ${tagName}`);
}

export async function resolveRegistrySnapshot({ registry, packageName, spec, timeoutMs = 30_000 }) {
  const url = `${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new GuardianError('REGISTRY_UNAVAILABLE', `cannot query ${packageName}: ${error.message}`);
  }
  if (!response.ok) throw new GuardianError('REGISTRY_UNAVAILABLE', `registry returned HTTP ${response.status} for ${packageName}`);
  const packument = await response.json();
  const version = packument['dist-tags']?.[spec] ?? (packument.versions?.[spec] ? spec : undefined);
  if (version === undefined) throw new GuardianError('VERSION_NOT_FOUND', `cannot resolve ${packageName}@${spec}`);
  const manifest = packument.versions?.[version];
  if (manifest === undefined) throw new GuardianError('VERSION_NOT_FOUND', `registry omitted manifest for ${packageName}@${version}`);
  if (typeof manifest.dist?.integrity !== 'string') {
    throw new GuardianError('REGISTRY_INVALID', `registry omitted integrity for ${packageName}@${version}`);
  }
  return {
    package: packageName,
    requested: spec,
    version,
    integrity: manifest.dist.integrity,
    shasum: manifest.dist.shasum ?? null,
    tarball: manifest.dist.tarball ?? null,
    publishedAt: packument.time?.[version] ?? null,
  };
}

/**
 * Resolve the newest official DSH GitHub release, then require the matching
 * published NPM package before returning an installable candidate. GitHub is
 * the update signal; NPM remains the reproducible runtime artifact.
 */
export async function resolveGitHubReleaseSnapshot({
  githubApi = 'https://api.github.com',
  repository = 'deepseek-ai/deepseek-harness',
  tagPrefix = 'dsh-v',
  includePrereleases = true,
  version,
  registry = 'https://registry.npmjs.org',
  packageName = '@deepseek-ai/dsh',
  timeoutMs = 30_000,
}) {
  repositoryPath(repository);
  if (typeof tagPrefix !== 'string' || tagPrefix === '' || !RELEASE_TAG_PATTERN.test(tagPrefix)) {
    throw new GuardianError('CONFIG_INVALID', 'watch.github_tag_prefix must contain only simple tag characters');
  }
  if (typeof includePrereleases !== 'boolean') {
    throw new GuardianError('CONFIG_INVALID', 'watch.github_include_prereleases must be boolean');
  }
  let releases = await fetchJson(
    `${githubApi.replace(/\/$/, '')}/repos/${repository}/releases?per_page=100`,
    timeoutMs,
  );
  if (!Array.isArray(releases)) throw new GuardianError('GITHUB_RELEASE_INVALID', 'GitHub API releases response was not an array');
  const candidates = releases
    .filter(release => release?.draft !== true)
    .map(release => ({ release, version: releaseVersion(release.tag_name, tagPrefix) }))
    .filter(item => item.version !== null)
    .filter(item => includePrereleases || !semver.prerelease(item.version));
  const selector = version && !['latest', 'next', 'alpha'].includes(version) ? version : null;
  if (selector && !semver.valid(selector)) {
    throw new GuardianError('CONFIG_INVALID', `GitHub release version selector is not a valid semantic version: ${selector}`);
  }
  const selected = selector
    ? candidates.find(item => item.version === selector)
    : candidates.sort((left, right) => semver.rcompare(left.version, right.version))[0];
  if (!selected) {
    const suffix = selector ? ` ${selector}` : '';
    throw new GuardianError('GITHUB_RELEASE_NOT_FOUND', `no matching DSH GitHub release${suffix}`);
  }
  const release = selected.release;
  const commit = await tagCommit({
    apiBase: githubApi,
    repository,
    tagName: release.tag_name,
    targetCommitish: release.target_commitish,
    timeoutMs,
  });
  const packageSnapshot = await resolveRegistrySnapshot({
    registry,
    packageName,
    spec: selected.version,
    timeoutMs,
  }).catch(error => {
    if (error.code === 'VERSION_NOT_FOUND') {
      throw new GuardianError(
        'NPM_ARTIFACT_PENDING',
        `GitHub release ${release.tag_name} is available, but NPM ${packageName}@${selected.version} is not ready: ${error.message}`,
        {
          release: {
            tag: release.tag_name,
            version: selected.version,
            commit,
            url: release.html_url ?? null,
            publishedAt: release.published_at ?? null,
          },
        },
      );
    }
    throw error;
  });
  return {
    ...packageSnapshot,
    requested: version ?? 'github-release',
    source: 'github-release',
    release: {
      tag: release.tag_name,
      version: selected.version,
      commit,
      url: release.html_url ?? null,
      publishedAt: release.published_at ?? null,
      prerelease: release.prerelease === true,
    },
  };
}

import { GuardianError } from './errors.js';

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

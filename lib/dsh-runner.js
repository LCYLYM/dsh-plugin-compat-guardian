// This released DSH CLI calls HMR.registerConfig. HMR 1.0.19 removed that
// method while remaining in its dependency range. Scope the measured workaround
// to the two measured legacy runners, leaving untested and new cohorts alone.
const measuredLegacyVersions = new Set(['0.1.1-rc.2', '0.1.2-rc.1']);
export function dshRunnerManifest(version) {
  return {
    private: true,
    ...(measuredLegacyVersions.has(version)
      ? { pnpm: { overrides: { '@deepseek-ai/cordis-plugin-hmr': '1.0.17' } } }
      : {}),
  };
}

export function dshRunnerPatches(version) {
  return measuredLegacyVersions.has(version) ? [{ insert: [
    { id: 'guardian-runtime-hmr', name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } },
  ] }] : [];
}

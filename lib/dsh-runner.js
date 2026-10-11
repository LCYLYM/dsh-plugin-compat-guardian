// This released DSH CLI calls HMR.registerConfig. HMR 1.0.19 removed that
// method while remaining in its dependency range. Scope the measured workaround
// to this exact legacy runner, leaving untested and new cohorts alone.
export function dshRunnerManifest(version) {
  return {
    private: true,
    ...(version === '0.1.1-rc.2'
      ? { pnpm: { overrides: { '@deepseek-ai/cordis-plugin-hmr': '1.0.17' } } }
      : {}),
  };
}

export function dshRunnerPatches(version) {
  return version === '0.1.1-rc.2' ? [{ insert: [
    { id: 'guardian-runtime-hmr', name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } },
  ] }] : [];
}

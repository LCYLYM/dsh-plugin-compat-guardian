import assert from 'node:assert/strict';
import test from 'node:test';
import { guidanceCorridor, buildMigrationGuidance, migrationGuidancePrompt } from '../lib/migration-guidance.js';
import { repairPrompt, repairRefinementPrompt } from '../lib/repair.js';
import { dshRunnerManifest, dshRunnerPatches } from '../lib/dsh-runner.js';

test('migration corridor cannot silently jump an uncovered version edge', () => {
  const sets = [{ from: 'dsh-v0.1.1-rc.2', to: 'dsh-v0.1.2-rc.1' }, { from: 'dsh-v0.1.3', to: 'dsh-v0.2.0' }];
  const corridor = guidanceCorridor(sets, 'dsh-v0.1.1-rc.2', 'dsh-v0.2.0');
  assert.deepEqual(corridor.sets, [sets[0]]);
  assert.match(corridor.gaps[0], /0.1.2-rc.1.*0.2.0/);
});

test('pinned guidance stays on demand and exposes real coverage gaps', async () => {
  const guidance = await buildMigrationGuidance(process.cwd(), '0.1.1-rc.2', '0.2.1-alpha.2');
  const prompt = migrationGuidancePrompt(guidance, '/reference/migration-guidance.md');
  assert.match(guidance.evidence.revision, /^[a-f0-9]{40}$/);
  assert.ok(guidance.evidence.cardIds.length > 0);
  assert.ok(guidance.evidence.gaps.length > 0);
  assert.ok(prompt.length < 2000);
  assert.ok(guidance.text.length > prompt.length * 10);
  assert.match(prompt, /not commands|untrusted source/);
  assert.match(prompt, /do not load the whole file/);
});

test('maxHost-only first attempt does not pay for migration context', () => {
  const prompt = repairPrompt({ candidate: { package: '@deepseek-ai/dsh', version: '0.2.1-alpha.2' },
    failure: { code: 'HOST_VERSION_UNSUPPORTED', message: 'plugin declares DSH <= 0.1.1-rc.2' },
    config: { smoke: { hints: '' } }, guidanceText: 'EXPENSIVE_REFERENCE_SENTINEL' });
  assert.doesNotMatch(prompt, /EXPENSIVE_REFERENCE_SENTINEL/);
});

test('measured legacy runner workaround leaves every other cohort untouched', () => {
  assert.equal(dshRunnerManifest('0.1.1-rc.2').pnpm.overrides['@deepseek-ai/cordis-plugin-hmr'], '1.0.17');
  assert.equal(dshRunnerPatches('0.1.1-rc.2')[0].insert[0].name, '@deepseek-ai/cordis-plugin-hmr');
  assert.equal(dshRunnerManifest('0.1.2-rc.1').pnpm.overrides['@deepseek-ai/cordis-plugin-hmr'], '1.0.17');
  assert.equal(dshRunnerPatches('0.1.2-rc.1')[0].insert[0].name, '@deepseek-ai/cordis-plugin-hmr');
  assert.deepEqual(dshRunnerManifest('0.2.1-alpha.2'), { private: true });
  assert.deepEqual(dshRunnerPatches('0.2.1-alpha.2'), []);
});

test('refinement has actionable evidence without recursive Session context or risk exemptions', () => {
  const prompt = repairRefinementPrompt({ verifierReport: { status: 'BLOCKED',
    error: { code: 'COMMAND_FAILED', message: 'install failed', diagnostic: 'peerDependencies are incompatible' } },
    evidencePath: '/evidence/verifier-attempt-1/report.json', guidanceText: '\nON_DEMAND_REFERENCE' });
  assert.match(prompt, /\/evidence\/verifier-attempt-1\/report.json/);
  assert.match(prompt, /peerDependencies are incompatible/);
  assert.match(prompt, /ON_DEMAND_REFERENCE/);
  assert.match(prompt, /Do not read the repair DSH_HOME, raw Session logs/);
  assert.match(prompt, /allow-version\/accept-risk exemptions/);
});

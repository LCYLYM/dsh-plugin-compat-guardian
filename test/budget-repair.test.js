import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { accumulateRouteCny, estimateCny, estimateRouteCny, priceBand, projectTokenUsage, readDshSearchTelemetry } from '../lib/budget.js';
import { assertRepairPaths, repairDshArgs, repairPrompt, repairResumeAllowed } from '../lib/repair.js';

test('usage projection replaces duplicate chunk/message samples per step', () => {
  const events = [
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } } } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 2 } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 20 } } } },
  ];
  assert.deepEqual(projectTokenUsage(events), {
    inputTokens: 13,
    outputTokens: 3,
    cacheReadTokens: 20,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  });
});

test('price map applies peak and low-price rates in Asia/Shanghai', () => {
  const pricing = {
    revision: 'test',
    timezone: 'Asia/Shanghai',
    peak_windows: [{ start: '09:00', end: '12:00' }],
    rates: {
      peak: { input_cache_hit: 0.1, input_cache_miss: 3, output: 9 },
      low_price: { input_cache_hit: 0.05, input_cache_miss: 1.5, output: 4.5 },
    },
  };
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
  const peakDate = new Date('2026-08-22T02:00:00Z');
  const lowDate = new Date('2026-08-22T05:00:00Z');
  assert.equal(priceBand(pricing, peakDate), 'peak');
  assert.equal(estimateCny(usage, pricing, peakDate).amount, 12.1);
  assert.equal(priceBand(pricing, lowDate), 'low_price');
  assert.equal(estimateCny(usage, pricing, lowDate).amount, 6.05);
});

test('campaign CNY adds each run at its own price band instead of repricing history', () => {
  const pricing = {
    revision: 'test', timezone: 'Asia/Shanghai', peak_windows: [{ start: '09:00', end: '12:00' }],
    applies_to: { provider: 'deepseek-official', model: 'official-model', base_url: 'https://api.deepseek.com' },
    rates: {
      peak: { input_cache_hit: 0.1, input_cache_miss: 3, output: 9 },
      low_price: { input_cache_hit: 0.05, input_cache_miss: 1.5, output: 4.5 },
    },
  };
  const route = pricing.applies_to;
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
  const peak = accumulateRouteCny(null, usage, pricing, route, new Date('2026-08-22T02:00:00Z'));
  const mixed = accumulateRouteCny(peak, usage, pricing, route, new Date('2026-08-22T05:00:00Z'));
  assert.deepEqual(peak, { amount: 12.1, band: 'peak', revision: 'test', known: true });
  assert.deepEqual(mixed, { amount: 18.15, band: 'mixed', revision: 'test', known: true });
});

test('CNY is unknown when the active provider route does not match the price map', () => {
  const pricing = {
    revision: 'test', timezone: 'Asia/Shanghai', peak_windows: [],
    applies_to: { provider: 'deepseek-official', model: 'official-model', base_url: 'https://api.deepseek.com' },
    rates: { peak: { input_cache_hit: 1, input_cache_miss: 1, output: 1 }, low_price: { input_cache_hit: 1, input_cache_miss: 1, output: 1 } },
  };
  const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 };
  assert.equal(estimateRouteCny(usage, pricing, { provider: 'custom', model: 'custom', base_url: 'https://example.invalid' }).amount, null);
  assert.equal(estimateRouteCny(usage, pricing, pricing.applies_to).known, true);
});

test('repair path guard permits plugin source and blocks control paths', () => {
  const protectedPaths = ['.github/workflows/**', '.dsh-compat.yml', '.dsh-compat.lock.json', 'compatibility/**'];
  assert.doesNotThrow(() => assertRepairPaths(['lib/index.js'], protectedPaths));
  assert.throws(() => assertRepairPaths(['compatibility/dsh-smoke.yml'], protectedPaths), { code: 'PROTECTED_PATH_CHANGED' });
  assert.throws(() => assertRepairPaths(['../outside'], protectedPaths), { code: 'REPAIR_PATH_ESCAPE' });
  assert.throws(() => assertRepairPaths(['config/credentials.json'], protectedPaths), { code: 'PROTECTED_PATH_CHANGED' });
  assert.throws(() => assertRepairPaths(['.pnpm-store/v10/files/cache-entry'], []), { code: 'PROTECTED_PATH_CHANGED' });
  assert.throws(() => assertRepairPaths(['node_modules/pkg/index.js'], []), { code: 'PROTECTED_PATH_CHANGED' });
});

test('repair path guard caps large blocked-path diagnostics', () => {
  const paths = Array.from({ length: 25 }, (_, index) => `.pnpm-store/v10/files/${index}`);
  assert.throws(
    () => assertRepairPaths(paths, []),
    error => error.code === 'PROTECTED_PATH_CHANGED' && error.message.includes('(+15 more)') && !error.message.includes('/24'),
  );
});

test('same-version repair resumes only on N-to-Y intent or a larger budget', () => {
  const previous = {
    automatic_repair_used: true,
    limits: { max_tokens: 100, max_cny: 10, max_wall_minutes: 60 },
  };
  assert.equal(repairResumeAllowed(previous, { max_tokens: 100, max_cny: 10, max_wall_minutes: 60 }, 'N'), false);
  assert.equal(repairResumeAllowed(previous, { max_tokens: 100, max_cny: 10, max_wall_minutes: 60 }, 'Y'), true);
  assert.equal(repairResumeAllowed(previous, { max_tokens: 101, max_cny: 10, max_wall_minutes: 60 }, 'N'), true);
});

test('repair invokes the rc.2 headless profile with launcher flags before the task', () => {
  assert.deepEqual(repairDshArgs('/tmp/repair.yml', 'fix the plugin'), [
    '--profile',
    'headless',
    '--patch',
    '/tmp/repair.yml',
    'fix the plugin',
  ]);
});

test('reviewed maxHost failures get a one-file first-attempt strategy', () => {
  const prompt = repairPrompt({
    candidate: { package: '@deepseek-ai/dsh', version: '0.1.2-rc.1' },
    failure: { code: 'HOST_VERSION_UNSUPPORTED', message: 'plugin declares DSH <= 0.1.1-rc.2, candidate is 0.1.2-rc.1' },
    config: { smoke: { hints: '' } },
  });
  assert.match(prompt, /change only dsh\.compat\.maxHost to 0\.1\.2-rc\.1/);
  assert.match(prompt, /Do not install dependencies/);
  assert.match(prompt, /independent Guardian verifier/);
});

test('search telemetry persists only counts and hashes, not queries or results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-search-'));
  try {
    await writeFile(join(root, 'session.jsonl'), [
      JSON.stringify({ type: 'tool/call', data: { callId: 'a', name: 'web_search', arguments: '{"query":"secret query"}' } }),
      JSON.stringify({ type: 'tool/result', data: { callId: 'a', message: { content: [{ type: 'text', text: 'private result' }] } } }),
    ].join('\n'));
    const telemetry = await readDshSearchTelemetry(root);
    assert.equal(telemetry.calls, 1);
    assert.doesNotMatch(JSON.stringify(telemetry), /secret query|private result/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { estimateCny, estimateRouteCny, priceBand, projectTokenUsage, readDshSearchTelemetry } from '../lib/budget.js';
import { assertRepairPaths, repairDshArgs, repairResumeAllowed } from '../lib/repair.js';

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

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown } from '../lib/report.js';

test('human report is Chinese-first, scannable, and keeps technical evidence collapsible', () => {
  const markdown = renderMarkdown({
    status: 'PASS',
    kind: 'repair',
    startedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:00:02.500Z',
    source: { commit: '1234567890abcdef' },
    candidate: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.2', integrity: 'sha512-demo', graphDigest: 'a'.repeat(64) },
    plugin: { name: 'demo-plugin', version: '1.0.0', tarballSha256: 'b'.repeat(64) },
    snapshotKey: 'c'.repeat(64),
    steps: [
      { name: 'pack-plugin', ok: true, durationMs: 1200 },
      { name: 'plugin-specific-smoke', ok: true, durationMs: 300 },
    ],
    repair: {
      dshVersion: '0.1.1-rc.2', provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp',
      changedPaths: ['src/index.ts'], patchSha256: 'd'.repeat(64),
      diffPolicy: { statistics: { files: 1, additions: 2, deletions: 1 }, disposition: 'pull-request', forceReview: [] },
    },
    budget: {
      usage: { totalTokens: 1234, inputTokens: 100, cacheReadTokens: 1000, outputTokens: 134 },
      estimatedCny: { amount: 0.01, band: 'low-price', revision: 'test-price' },
      limits: { max_tokens: 1000000, max_cny: 10, max_wall_minutes: 60 },
    },
  });

  assert.match(markdown, /DSH 插件兼容性报告/);
  assert.match(markdown, /✅ 已通过/);
  assert.match(markdown, /一眼看懂/);
  assert.match(markdown, /预算与用量/);
  assert.match(markdown, /自动修复/);
  assert.match(markdown, /<details>/);
  assert.match(markdown, /打包真实插件/);
  assert.match(markdown, /不保存 API Key/);
  assert.doesNotMatch(markdown, /DSH compatibility report|Blocking error|Repair budget/);
});

test('blocked report explains the next action without hiding the error code', () => {
  const markdown = renderMarkdown({
    status: 'BLOCKED_EXTERNAL',
    candidate: { version: '0.1.1-rc.2' },
    steps: [],
    error: { code: 'MODEL_SMOKE_RPC', message: 'RPC 尚未就绪' },
  });
  assert.match(markdown, /外部服务暂不可用/);
  assert.match(markdown, /schedule 不会循环烧额度/);
  assert.match(markdown, /MODEL_SMOKE_RPC/);
});

test('onboarding report explains why automatic repair does not start', () => {
  const markdown = renderMarkdown({
    status: 'BLOCKED',
    error: { code: 'ONBOARDING_BLOCKED', message: '参考版本依赖安装失败' },
    candidate: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    steps: [{ name: 'install-repository-dependencies', ok: false, durationMs: 10 }],
  });
  assert.match(markdown, /不能把它当成“升级导致的回归”自动修/);
  assert.match(markdown, /ONBOARDING_BLOCKED/);
});

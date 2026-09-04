import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stringify } from 'yaml';

import { DEFAULT_CONFIG } from '../lib/config.js';
import { dshRouteEnvironment, dshRouteRows } from '../lib/dsh-route.js';
import { GuardianError } from '../lib/errors.js';
import { classifyModelFailure } from '../lib/model-failure.js';
import { repairRepository } from '../lib/repair.js';

const CASES = [
  ['missing key', new GuardianError('MODEL_CREDENTIAL_MISSING', 'missing key'), 'BLOCKED_CONFIG', 'MODEL_CREDENTIAL_MISSING', false],
  ['401', new GuardianError('MODEL_RESPONSE', 'HTTP 401 unauthorized'), 'BLOCKED_CONFIG', 'MODEL_CREDENTIAL_REJECTED', false],
  ['bad model', new GuardianError('MODEL_RESPONSE', 'model not found: wrong-model'), 'BLOCKED_CONFIG', 'MODEL_NOT_FOUND', false],
  ['bad base URL', new GuardianError('MODEL_RESPONSE', 'HTTP 404 endpoint not found'), 'BLOCKED_CONFIG', 'MODEL_ENDPOINT_NOT_FOUND', false],
  ['429', new GuardianError('MODEL_RESPONSE', 'HTTP 429 too many requests'), 'BLOCKED_EXTERNAL', 'MODEL_RATE_LIMITED', true],
  ['5xx', new GuardianError('MODEL_RESPONSE', 'HTTP 503 service unavailable'), 'BLOCKED_EXTERNAL', 'MODEL_PROVIDER_5XX', true],
  ['provider overload', new GuardianError('MODEL_RESPONSE', 'SERVER: system cpu overloaded (current: 99.6%, threshold: 90%)'), 'BLOCKED_EXTERNAL', 'MODEL_PROVIDER_5XX', true],
  ['timeout', new GuardianError('MODEL_RESPONSE', 'request timed out'), 'BLOCKED_EXTERNAL', 'MODEL_PROVIDER_TIMEOUT', true],
  ['unreachable URL', new GuardianError('MODEL_RESPONSE', 'fetch failed: ECONNREFUSED'), 'BLOCKED_CONFIG', 'MODEL_PROVIDER_UNREACHABLE', false],
  ['unregistered provider', new GuardianError('MODEL_RESPONSE', 'no adapter registered for provider acme'), 'BLOCKED_CONFIG', 'MODEL_PROVIDER_NOT_REGISTERED', false],
  ['invalid request cap', new GuardianError('MODEL_RESPONSE', 'INVALID_REQUEST: max_tokens参数非法：限制数值范围[1,131072]'), 'BLOCKED_CONFIG', 'MODEL_REQUEST_INVALID', false],
];

for (const [name, error, status, code, retryable] of CASES) {
  test(`model failure classifies ${name} without persisting raw provider output`, () => {
    const result = classifyModelFailure(error);
    assert.equal(result.status, status);
    assert.equal(result.code, code);
    assert.equal(result.retryable, retryable);
    assert.doesNotMatch(result.message, /wrong-model|acme|ECONNREFUSED/);
  });
}

test('custom DeepSeek env reference, base URLs, and model are wired into native DSH rows', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.credentials.api_key_env = 'MY_REPOSITORY_KEY';
  config.credentials.base_url = 'https://gateway.example.test/v1';
  config.credentials.search_base_url = 'https://gateway.example.test/anthropic/v1';
  config.repair.model = 'custom-model-id';
  config.repair.max_output_tokens = 131_072;
  const rows = dshRouteRows(config);
  assert.deepEqual(rows.find(row => row.id === 'llm-deepseek').config, {
    apiKeyEnv: 'MY_REPOSITORY_KEY',
    baseURL: 'https://gateway.example.test/v1',
    maxTokens: 131_072,
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      backoff: { initialDelayMs: 120_000, maxDelayMs: 120_000, jitterRatio: 0 },
    },
  });
  assert.equal(rows.find(row => row.id === 'agent-default-model').config.model, 'custom-model-id');
  assert.equal(rows.find(row => row.id === 'web-search-deepseek').config.baseURL, 'https://gateway.example.test/anthropic/v1');
  const env = dshRouteEnvironment(config, 'test-secret', {});
  assert.equal(env.MY_REPOSITORY_KEY, 'test-secret');
  assert.equal(env.DEEPSEEK_API_KEY, 'test-secret');
  assert.equal(env.DEEPSEEK_BASE_URL, 'https://gateway.example.test/v1');
});

test('repair missing key writes a durable BLOCKED_CONFIG lock without consuming a repair round', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'guardian-missing-key-repo-'));
  const output = await mkdtemp(join(tmpdir(), 'guardian-missing-key-output-'));
  const previousDefaultKey = process.env.DEEPSEEK_API_KEY;
  const previousCustomKey = process.env.GUARDIAN_TEST_MISSING_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.GUARDIAN_TEST_MISSING_KEY;
  try {
    await writeFile(join(repo, '.dsh-compat.yml'), stringify({
      schema: 1,
      repair: { start_policy: 'immediate' },
      credentials: { api_key_env: 'GUARDIAN_TEST_MISSING_KEY' },
    }));
    await writeFile(join(repo, '.dsh-compat.lock.json'), '{"schema":1,"resetBudget":"N","verified":null,"campaigns":{}}\n');
    const failurePath = join(repo, 'failure.json');
    await writeFile(failurePath, JSON.stringify({
      status: 'BLOCKED', source: { commit: 'abc123' }, candidate: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      plugin: { name: 'fixture' }, error: { code: 'PLUGIN_ASSERTION_FAILED', message: 'fixture' },
    }));
    await assert.rejects(() => repairRepository({ repoPath: repo, failureReportPath: failurePath, outputDirectory: output }), {
      code: 'MODEL_CREDENTIAL_MISSING',
    });
    const lock = JSON.parse(await readFile(join(output, 'blocked-lock.json'), 'utf8'));
    const campaign = lock.campaigns['0.1.1-rc.2'];
    assert.equal(campaign.status, 'BLOCKED_CONFIG');
    assert.equal(campaign.automatic_repair_used, false);
    assert.equal(campaign.attempts_used, 0);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    assert.equal(report.status, 'BLOCKED_CONFIG');
  } finally {
    if (previousDefaultKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousDefaultKey;
    if (previousCustomKey === undefined) delete process.env.GUARDIAN_TEST_MISSING_KEY;
    else process.env.GUARDIAN_TEST_MISSING_KEY = previousCustomKey;
    await Promise.all([rm(repo, { recursive: true, force: true }), rm(output, { recursive: true, force: true })]);
  }
});

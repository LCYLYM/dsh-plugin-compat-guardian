import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { parse } from 'yaml';

import { GuardianError } from './errors.js';

export const DEFAULT_CONFIG = Object.freeze({
  schema: 1,
  watch: {
    registry: 'https://registry.npmjs.org',
    package: '@deepseek-ai/dsh',
    channel: 'latest',
  },
  runtime: {
    node: 'auto',
    package_manager: 'auto',
    runner: 'ubuntu-24.04',
  },
  repair: {
    dsh_version: '0.1.1-rc.2',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash-vision-exp',
    model_policy: 'pin-per-campaign',
    start_policy: 'low-price-window',
    allow_manual_price_override: true,
    max_attempts: 2,
    search: {
      enabled: true,
      model: 'deepseek-v4-flash-vision-exp',
    },
    protected_paths: [
      '.github/workflows/**',
      '.dsh-compat.yml',
      '.dsh-compat.lock.json',
      'compatibility/**',
    ],
  },
  credentials: {
    api_key_env: 'DEEPSEEK_API_KEY',
    base_url: 'https://api.deepseek.com',
    base_url_env: 'DEEPSEEK_BASE_URL',
    // rc.2 appends /messages itself, so its Anthropic search base includes /v1.
    search_base_url: 'https://api.deepseek.com/anthropic/v1',
    search_base_url_env: 'DEEPSEEK_SEARCH_BASE_URL',
  },
  plugin: {
    workspace: '.',
    package_json: 'package.json',
    profile: 'web',
    install_from: 'npm-pack',
    surface: 'web',
  },
  smoke: {
    contract: 'compatibility/dsh-smoke.yml',
    hints: '',
  },
  gates: {
    repository: ['npm test', 'npm pack --dry-run'],
    require_install_remove_roundtrip: true,
    require_dump_config: true,
    require_real_web_boot: true,
    require_plugin_assertion: true,
  },
  budget: {
    max_tokens: 1_000_000,
    max_cny: 10,
    max_wall_minutes: 60,
    converge_remaining_ratio: 0.30,
    converge_message_enabled: true,
  },
  pricing: {
    revision: 'deepseek-public-2026-08-21',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    applies_to: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      base_url: 'https://api.deepseek.com',
    },
    currency: 'CNY',
    unit: 'per_million_tokens',
    timezone: 'Asia/Shanghai',
    peak_windows: [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    rates: {
      peak: { input_cache_hit: 0.10, input_cache_miss: 3.00, output: 9.00 },
      low_price: { input_cache_hit: 0.05, input_cache_miss: 1.50, output: 4.50 },
    },
  },
  delivery: {
    mode: 'pull-request',
    branch_prefix: 'automation/dsh-compat',
    publisher_token_env: 'DSH_GUARDIAN_PUBLISH_TOKEN',
  },
  notifications: {
    github_summary: true,
    github_issue_on_blocked: true,
    email: false,
    telegram: false,
    webhook: false,
  },
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeConfig(base, override) {
  if (!isObject(override)) return override === undefined ? base : override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(base?.[key])
      ? mergeConfig(base[key], value)
      : value;
  }
  return result;
}

function validateConfig(config) {
  if (config.schema !== 1) throw new GuardianError('CONFIG_INVALID', 'config schema must be 1');
  if (config.watch?.package !== '@deepseek-ai/dsh') {
    throw new GuardianError('CONFIG_INVALID', 'V1 only watches @deepseek-ai/dsh');
  }
  if (!['npm-pack'].includes(config.plugin?.install_from)) {
    throw new GuardianError('CONFIG_INVALID', 'plugin.install_from must be npm-pack in M0');
  }
  if (!['pull-request', 'auto-merge', 'direct-push'].includes(config.delivery?.mode)) {
    throw new GuardianError('CONFIG_INVALID', 'delivery.mode is invalid');
  }
  if (!Array.isArray(config.gates?.repository) || config.gates.repository.some(item => typeof item !== 'string')) {
    throw new GuardianError('CONFIG_INVALID', 'gates.repository must be a list of command strings');
  }
  if (typeof config.plugin?.workspace !== 'string' || config.plugin.workspace.trim() === '') {
    throw new GuardianError('CONFIG_INVALID', 'plugin.workspace must be a repository-relative directory');
  }
  if (typeof config.plugin?.package_json !== 'string' || config.plugin.package_json.trim() === '') {
    throw new GuardianError('CONFIG_INVALID', 'plugin.package_json must be relative to plugin.workspace');
  }
  return config;
}

export async function resolvePluginPaths(repoPath, config) {
  const root = await realpath(resolve(repoPath));
  let workspace;
  let packageJson;
  try {
    workspace = await realpath(resolve(root, config.plugin.workspace));
    packageJson = await realpath(resolve(workspace, config.plugin.package_json));
  } catch (error) {
    throw new GuardianError('PLUGIN_WORKSPACE_INVALID', `cannot resolve plugin workspace/package.json: ${error.message}`);
  }
  const workspaceRelative = relative(root, workspace);
  const packageRelative = relative(workspace, packageJson);
  if (workspaceRelative === '..' || workspaceRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || packageRelative === '..' || packageRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new GuardianError('PLUGIN_WORKSPACE_ESCAPE', 'plugin workspace/package.json resolves outside the repository');
  }
  return { root, workspace, packageJson, workspaceRelative: workspaceRelative || '.' };
}

export async function loadConfig(repoPath, configPath = '.dsh-compat.yml') {
  const absolute = resolve(repoPath, configPath);
  let override = {};
  try {
    override = parse(await readFile(absolute, 'utf8')) ?? {};
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new GuardianError('CONFIG_INVALID', `cannot read ${configPath}: ${error.message}`);
  }
  return { path: absolute, config: validateConfig(mergeConfig(structuredClone(DEFAULT_CONFIG), override)) };
}

export async function loadContract(repoPath, contractPath) {
  const absolute = resolve(repoPath, contractPath);
  let contract;
  try {
    contract = parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new GuardianError('CONTRACT_INVALID', `cannot read smoke contract ${contractPath}: ${error.message}`);
  }
  validateContract(contract);
  return { path: absolute, contract };
}

export function validateContract(contract) {
  if (contract?.schema !== 1) throw new GuardianError('CONTRACT_INVALID', 'smoke contract schema must be 1');
  if (contract.requires_model_turn === true) {
    if (!['candidate-only', 'differential'].includes(contract.model_turn_scope)) {
      throw new GuardianError('CONTRACT_INVALID', 'model_turn_scope must be candidate-only or differential');
    }
    if (!['fixed', 'agent-selected'].includes(contract.fixture_mode)) {
      throw new GuardianError('CONTRACT_INVALID', 'fixture_mode must be fixed or agent-selected');
    }
    if (typeof contract.model_smoke?.prompt !== 'string' || contract.model_smoke.prompt.trim() === '') {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.prompt is required');
    }
    if (!Array.isArray(contract.model_smoke?.fixtures) || contract.model_smoke.fixtures.length === 0) {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.fixtures must contain a reviewed fixture');
    }
    if (!Array.isArray(contract.model_smoke?.required_event_types) || contract.model_smoke.required_event_types.length === 0) {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.required_event_types must prove plugin handling');
    }
    if (contract.model_smoke.plugin_upload !== undefined
      && (typeof contract.model_smoke.plugin_upload.endpoint_root !== 'string'
        || !contract.model_smoke.plugin_upload.endpoint_root.startsWith('/'))) {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.plugin_upload.endpoint_root must be an absolute HTTP path');
    }
  }
  const assertions = contract.web?.assertions;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new GuardianError('CONTRACT_INVALID', 'smoke contract must contain at least one web assertion');
  }
  return contract;
}

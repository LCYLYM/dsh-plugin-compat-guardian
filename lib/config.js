import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { parse } from 'yaml';

import { GuardianError } from './errors.js';

export const DEFAULT_CONFIG = Object.freeze({
  schema: 1,
  watch: {
    // GitHub is the authoritative update signal; NPM remains the install artifact.
    source: 'github-release',
    github_api: 'https://api.github.com',
    github_repository: 'deepseek-ai/deepseek-harness',
    github_tag_prefix: 'dsh-v',
    github_include_prereleases: true,
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
    // Optional provider-compatible cap for one model response. null keeps the
    // selected DSH adapter's own default.
    max_output_tokens: null,
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
      // Package-manager stores are generated caches, never plugin source.
      'node_modules/**',
      '.pnpm-store/**',
      '.npm/**',
      '.yarn/cache/**',
    ],
  },
  credentials: {
    api_key_env: 'DEEPSEEK_API_KEY',
    base_url: 'https://api.deepseek.com',
    // rc.2 appends /messages itself, so its Anthropic search base includes /v1.
    search_base_url: 'https://api.deepseek.com/anthropic/v1',
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

function requireText(value, path, pattern) {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GuardianError('CONFIG_INVALID', `${path} must be a non-empty string without control characters`);
  }
  if (pattern && !pattern.test(value)) throw new GuardianError('CONFIG_INVALID', `${path} has an invalid format`);
}

function requireHttpUrl(value, path) {
  requireText(value, path);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GuardianError('CONFIG_INVALID', `${path} must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw new GuardianError('CONFIG_INVALID', `${path} must be a credential-free absolute http(s) URL without a fragment`);
  }
}

function requirePositiveNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new GuardianError('CONFIG_INVALID', `${path} must be a positive finite number`);
  }
}

export function validateConfig(config) {
  if (config.schema !== 1) throw new GuardianError('CONFIG_INVALID', 'config schema must be 1');
  if (config.watch?.package !== '@deepseek-ai/dsh') {
    throw new GuardianError('CONFIG_INVALID', 'V1 only watches @deepseek-ai/dsh');
  }
  if (!['github-release', 'npm'].includes(config.watch?.source)) {
    throw new GuardianError('CONFIG_INVALID', 'watch.source must be github-release or npm');
  }
  if (config.watch.source === 'github-release') {
    requireHttpUrl(config.watch.github_api, 'watch.github_api');
    requireText(config.watch.github_repository, 'watch.github_repository', /^[^/\s]+\/[^/\s]+$/);
    requireText(config.watch.github_tag_prefix, 'watch.github_tag_prefix', /^[A-Za-z0-9._-]+$/);
    if (typeof config.watch.github_include_prereleases !== 'boolean') {
      throw new GuardianError('CONFIG_INVALID', 'watch.github_include_prereleases must be boolean');
    }
  }
  requireHttpUrl(config.watch.registry, 'watch.registry');
  if (!['npm-pack'].includes(config.plugin?.install_from)) {
    throw new GuardianError('CONFIG_INVALID', 'plugin.install_from must be npm-pack in M0');
  }
  if (!['pull-request', 'auto-merge', 'direct-push'].includes(config.delivery?.mode)) {
    throw new GuardianError('CONFIG_INVALID', 'delivery.mode is invalid');
  }
  if (config.delivery?.branch_prefix !== 'automation/dsh-compat') {
    throw new GuardianError('CONFIG_INVALID', 'delivery.branch_prefix is fixed to automation/dsh-compat in V1 so dedupe and publication use one namespace');
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
  requireText(config.repair?.dsh_version, 'repair.dsh_version');
  requireText(config.repair?.provider, 'repair.provider', /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  requireText(config.repair?.model, 'repair.model');
  if (config.repair?.max_output_tokens !== null
    && (!Number.isSafeInteger(config.repair?.max_output_tokens) || config.repair.max_output_tokens < 1)) {
    throw new GuardianError('CONFIG_INVALID', 'repair.max_output_tokens must be null or a positive safe integer');
  }
  requireText(config.repair?.search?.model, 'repair.search.model');
  if (!['immediate', 'low-price-window'].includes(config.repair?.start_policy)) {
    throw new GuardianError('CONFIG_INVALID', 'repair.start_policy must be immediate or low-price-window');
  }
  if (typeof config.repair?.search?.enabled !== 'boolean') {
    throw new GuardianError('CONFIG_INVALID', 'repair.search.enabled must be boolean');
  }
  if (!Array.isArray(config.repair?.protected_paths)
    || config.repair.protected_paths.some(path => typeof path !== 'string' || path.trim() === '')) {
    throw new GuardianError('CONFIG_INVALID', 'repair.protected_paths must be a list of non-empty strings');
  }
  requireText(config.credentials?.api_key_env, 'credentials.api_key_env', /^[A-Za-z_][A-Za-z0-9_]*$/);
  if (Object.hasOwn(config.credentials ?? {}, 'base_url_env') || Object.hasOwn(config.credentials ?? {}, 'search_base_url_env')) {
    throw new GuardianError('CONFIG_INVALID', 'credentials.base_url_env/search_base_url_env were removed; set base_url/search_base_url directly');
  }
  requireHttpUrl(config.credentials?.base_url, 'credentials.base_url');
  requireHttpUrl(config.credentials?.search_base_url, 'credentials.search_base_url');
  requirePositiveNumber(config.budget?.max_tokens, 'budget.max_tokens');
  requirePositiveNumber(config.budget?.max_cny, 'budget.max_cny');
  requirePositiveNumber(config.budget?.max_wall_minutes, 'budget.max_wall_minutes');
  if (!Number.isInteger(config.repair?.max_attempts) || config.repair.max_attempts < 1) {
    throw new GuardianError('CONFIG_INVALID', 'repair.max_attempts must be a positive integer');
  }
  if (typeof config.budget?.converge_remaining_ratio !== 'number'
    || config.budget.converge_remaining_ratio <= 0 || config.budget.converge_remaining_ratio >= 1) {
    throw new GuardianError('CONFIG_INVALID', 'budget.converge_remaining_ratio must be greater than 0 and less than 1');
  }
  if (typeof config.budget?.converge_message_enabled !== 'boolean') {
    throw new GuardianError('CONFIG_INVALID', 'budget.converge_message_enabled must be boolean');
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
    if (typeof contract.model_smoke?.prompt !== 'string' || contract.model_smoke.prompt.trim() === '') {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.prompt is required');
    }
    const inputMode = contract.model_smoke?.input_mode ?? 'visual';
    if (!['visual', 'text'].includes(inputMode)) {
      throw new GuardianError('CONTRACT_INVALID', 'model_smoke.input_mode must be visual or text');
    }
    if (inputMode === 'visual') {
      if (!['fixed', 'agent-selected'].includes(contract.fixture_mode)) {
        throw new GuardianError('CONTRACT_INVALID', 'visual model smoke requires fixture_mode fixed or agent-selected');
      }
      if (!Array.isArray(contract.model_smoke?.fixtures) || contract.model_smoke.fixtures.length === 0) {
        throw new GuardianError('CONTRACT_INVALID', 'visual model smoke requires a reviewed fixture');
      }
    } else {
      if (contract.fixture_mode !== 'none') {
        throw new GuardianError('CONTRACT_INVALID', 'text model smoke requires fixture_mode none');
      }
      if (contract.model_smoke?.fixtures !== undefined) {
        throw new GuardianError('CONTRACT_INVALID', 'text model smoke must not declare visual fixtures');
      }
      if (contract.model_smoke?.plugin_upload !== undefined) {
        throw new GuardianError('CONTRACT_INVALID', 'text model smoke must not declare plugin_upload');
      }
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

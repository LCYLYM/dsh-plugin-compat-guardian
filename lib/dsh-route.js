import { sha256 } from './hash.js';

export function dshRouteRows(config) {
  const rows = [
    {
      id: 'llm-deepseek',
      config: {
        apiKeyEnv: config.credentials.api_key_env,
        baseURL: config.credentials.base_url,
        ...(config.repair.max_output_tokens === null ? {} : { maxTokens: config.repair.max_output_tokens }),
        // Keep transient provider retries inside the same bounded DSH turn.
        // Two fixed two-minute gaps give overload/rate-limit windows time to
        // recover without adding a Guardian-level loop or unbounded spending.
        retryPolicy: {
          mode: 'normal',
          maxRetries: 2,
          backoff: { initialDelayMs: 120_000, maxDelayMs: 120_000, jitterRatio: 0 },
        },
      },
    },
    { id: 'agent-default-model', config: { provider: config.repair.provider, model: config.repair.model } },
    // Session titles are unrelated to compatibility evidence and would make an
    // extra provider request outside the one repair/smoke turn being budgeted.
    { id: 'session-title-llm', disabled: true },
  ];
  if (config.repair.search.enabled) {
    rows.push({
      id: 'web-search-deepseek',
      config: {
        apiKeyEnv: config.credentials.api_key_env,
        baseURL: config.credentials.search_base_url,
        model: config.repair.search.model,
      },
    });
  }
  return rows;
}

export function dshRouteEnvironment(config, credential, environment = process.env) {
  return {
    ...environment,
    DEEPSEEK_API_KEY: credential,
    DEEPSEEK_BASE_URL: config.credentials.base_url,
    DEEPSEEK_SEARCH_BASE_URL: config.credentials.search_base_url,
    [config.credentials.api_key_env]: credential,
  };
}

export function routeFingerprint(config) {
  return sha256(JSON.stringify({
    provider: config.repair.provider,
    model: config.repair.model,
    maxOutputTokens: config.repair.max_output_tokens,
    apiKeyEnv: config.credentials.api_key_env,
    baseUrl: config.credentials.base_url.replace(/\/+$/, ''),
    search: config.repair.search.enabled ? {
      model: config.repair.search.model,
      baseUrl: config.credentials.search_base_url.replace(/\/+$/, ''),
    } : null,
  }));
}

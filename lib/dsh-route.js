import { sha256 } from './hash.js';

export function dshRouteRows(config) {
  const rows = [
    {
      id: 'llm-deepseek',
      config: {
        apiKeyEnv: config.credentials.api_key_env,
        baseURL: config.credentials.base_url,
        // One DSH provider retry is the whole transient retry allowance. Guardian
        // must not stack another retry loop on top of the adapter.
        retryPolicy: { mode: 'normal', maxRetries: 1 },
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
    apiKeyEnv: config.credentials.api_key_env,
    baseUrl: config.credentials.base_url.replace(/\/+$/, ''),
    search: config.repair.search.enabled ? {
      model: config.repair.search.model,
      baseUrl: config.credentials.search_base_url.replace(/\/+$/, ''),
    } : null,
  }));
}

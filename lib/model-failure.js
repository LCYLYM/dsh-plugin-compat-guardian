import { CommandError, GuardianError } from './errors.js';

const RULES = [
  { code: 'MODEL_CREDENTIAL_MISSING', status: 'BLOCKED_CONFIG', retryable: false, pattern: /MODEL_CREDENTIAL_MISSING|missing.*(?:api[ _-]?key|credential)|(?:api[ _-]?key|credential).*missing/i, message: '缺少模型 API Key。请配置仓库 Secret 后手工重跑。' },
  { code: 'MODEL_CREDENTIAL_REJECTED', status: 'BLOCKED_CONFIG', retryable: false, pattern: /\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[_ -]?(?:api[_ -]?)?key|incorrect api key/i, message: '模型服务拒绝了凭据（401/403）。请更新仓库 Secret 后手工重跑。' },
  { code: 'MODEL_NOT_FOUND', status: 'BLOCKED_CONFIG', retryable: false, pattern: /(?:model[^\n]{0,80}(?:not found|does not exist|unknown|invalid|unavailable))|(?:not found[^\n]{0,80}model)/i, message: '配置的 model ID 不可用。请更正 model 后手工重跑。' },
  { code: 'MODEL_PROVIDER_NOT_REGISTERED', status: 'BLOCKED_CONFIG', retryable: false, pattern: /no adapter|adapter.*not (?:found|registered)|provider[^\n]{0,80}(?:not found|not registered|unknown|unsupported)/i, message: '当前 DSH profile 没有注册该 provider adapter。请改用已注册的 provider 或先在 DSH profile 中配置它。' },
  { code: 'MODEL_RATE_LIMITED', status: 'BLOCKED_EXTERNAL', retryable: true, pattern: /\b429\b|rate[_ -]?limit|too many requests/i, message: '模型服务限流（429），当次最多重试一次；仍失败则冻结定时重跑。' },
  { code: 'MODEL_PROVIDER_TIMEOUT', status: 'BLOCKED_EXTERNAL', retryable: true, pattern: /timed?\s*out|timeout|ETIMEDOUT|AbortError/i, message: '模型服务请求超时，当次最多重试一次；仍失败则冻结定时重跑。' },
  { code: 'MODEL_PROVIDER_5XX', status: 'BLOCKED_EXTERNAL', retryable: true, pattern: /(?:HTTP|status|code)?\s*5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout/i, message: '模型服务返回 5xx，当次最多重试一次；仍失败则冻结定时重跑。' },
  { code: 'MODEL_ENDPOINT_NOT_FOUND', status: 'BLOCKED_CONFIG', retryable: false, pattern: /\b404\b|endpoint[^\n]{0,80}not found/i, message: '模型 API 端点不存在（404）。请检查 base URL 后手工重跑。' },
  { code: 'MODEL_PROVIDER_UNREACHABLE', status: 'BLOCKED_CONFIG', retryable: false, pattern: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|\bTRANSPORT\b|network error|fetch failed|socket hang up|connection refused/i, message: '无法连接配置的模型 base URL。请检查 URL、DNS 和网络后手工重跑。' },
];

function evidence(error) {
  if (error instanceof CommandError) {
    return [error.code, error.message, error.result?.stdout, error.result?.stderr, error.result?.spawnError].filter(Boolean).join('\n');
  }
  return [error?.code, error?.message, error?.cause?.message].filter(Boolean).join('\n');
}

export function classifyModelFailure(error) {
  const text = evidence(error);
  const rule = RULES.find(item => item.pattern.test(text));
  if (rule) return { ...rule, originalCode: error?.code ?? 'UNKNOWN' };
  if (error?.code === 'BLOCKED_CONTRACT') {
    return { code: 'BLOCKED_CONTRACT', status: 'BLOCKED_CONTRACT', retryable: false, message: error.message, originalCode: error.code };
  }
  if (error?.code === 'BUDGET_EXHAUSTED') {
    return { code: 'BUDGET_EXHAUSTED', status: 'BLOCKED', retryable: false, message: '本版本维修预算已用完，需要 resetBudget 或增加额度后才能继续。', originalCode: error.code };
  }
  return {
    code: error?.code ?? 'MODEL_FAILURE',
    status: 'BLOCKED',
    retryable: false,
    message: error instanceof GuardianError ? error.message : '模型调用失败，已停止并等待人工检查。',
    originalCode: error?.code ?? 'UNKNOWN',
  };
}

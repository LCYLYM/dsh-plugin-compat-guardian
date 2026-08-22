import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from './config.js';

export function deliveryPlan(config, report = {}) {
  const requested = config.delivery.mode;
  const forced = report.repair?.diffPolicy?.disposition === 'pull-request';
  return {
    requested,
    effective: forced ? 'pull-request' : requested,
    forcedHumanReview: forced,
    reasons: forced ? report.repair.diffPolicy.forceReview : [],
  };
}

export async function loadDeliveryPlan(repoPath, reportPath) {
  const [{ config }, report] = await Promise.all([
    loadConfig(repoPath),
    reportPath ? readFile(resolve(reportPath), 'utf8').then(JSON.parse) : {},
  ]);
  return deliveryPlan(config, report);
}

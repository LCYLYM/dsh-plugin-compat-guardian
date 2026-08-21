#!/usr/bin/env node

import { main } from '../lib/cli.js';

main(process.argv.slice(2)).catch(error => {
  const code = Number.isInteger(error?.exitCode) ? error.exitCode : 2;
  process.stderr.write(`guardian: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = code;
});

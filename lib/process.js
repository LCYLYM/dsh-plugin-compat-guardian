import { spawn } from 'node:child_process';
import process from 'node:process';

import { CommandError } from './errors.js';

const OUTPUT_LIMIT = 1024 * 1024;

function appendBounded(current, chunk, limit = OUTPUT_LIMIT) {
  const next = current + chunk;
  if (next.length <= limit) return next;
  return `[output truncated to final ${limit} characters]\n${next.slice(-limit)}`;
}

function quote(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

export function commandDisplay(command, args = []) {
  return [command, ...args].map(value => quote(String(value))).join(' ');
}

export function redactText(input, secretValues = []) {
  let value = String(input ?? '');
  for (const secret of secretValues.filter(item => typeof item === 'string' && item.length >= 4)) {
    value = value.split(secret).join('[REDACTED]');
  }
  return value
    .replace(/(["']?authorization["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^\s,;}"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s,;}"']+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const onClose = () => resolve();
    child.once('close', onClose);
    // The process can exit between the check above and listener registration.
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off('close', onClose);
      resolve();
    }
  });
}

function terminate(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child below.
    }
  }
  child.kill(signal);
}

export async function runCommand(command, args = [], options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const outputLimit = options.outputLimit ?? OUTPUT_LIMIT;
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    if (stdout.length + text.length > outputLimit) stdoutTruncated = true;
    stdout = appendBounded(stdout, text, outputLimit);
    options.onStdout?.(text);
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    if (stderr.length + text.length > outputLimit) stderrTruncated = true;
    stderr = appendBounded(stderr, text, outputLimit);
    options.onStderr?.(text);
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate(child);
    setTimeout(() => terminate(child, 'SIGKILL'), 2_000).unref();
  }, timeoutMs);
  timeout.unref();

  const { exitCode, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, closeSignal) => resolve({ exitCode: code, signal: closeSignal }));
  }).finally(() => clearTimeout(timeout));

  const secretValues = options.secretValues ?? [];
  const redact = options.redactOutput !== false;
  const result = {
    displayCommand: options.displayCommand ?? commandDisplay(command, args),
    exitCode,
    signal,
    timedOut,
    timeoutMs,
    durationMs: Date.now() - started,
    stdoutTruncated,
    stderrTruncated,
    stdout: redact ? redactText(stdout, secretValues) : stdout,
    stderr: redact ? redactText(stderr, secretValues) : stderr,
  };
  if ((exitCode !== 0 || timedOut) && options.reject !== false) throw new CommandError(result);
  return result;
}

export function shellCommand(command, options = {}) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NonInteractive', '-Command', command]
    : ['-lc', command];
  return runCommand(shell, args, { ...options, displayCommand: command });
}

export function startService(command, args = [], options = {}) {
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout = appendBounded(stdout, chunk.toString());
    options.onStdout?.(chunk.toString());
  });
  child.stderr.on('data', chunk => {
    stderr = appendBounded(stderr, chunk.toString());
    options.onStderr?.(chunk.toString());
  });
  let spawnError;
  child.once('error', error => {
    spawnError = error;
  });

  return {
    child,
    get exited() {
      return child.exitCode !== null || child.signalCode !== null;
    },
    snapshot(secretValues = []) {
      return {
        displayCommand: commandDisplay(command, args),
        exitCode: child.exitCode,
        signal: child.signalCode,
        durationMs: Date.now() - started,
        stdout: redactText(stdout, secretValues),
        stderr: redactText(stderr, secretValues),
        spawnError: spawnError?.message,
      };
    },
    async stop(graceMs = 5_000) {
      if (child.exitCode !== null || child.signalCode !== null) return this.snapshot();
      terminate(child);
      const closed = waitForClose(child);
      const forced = new Promise(resolve => setTimeout(resolve, graceMs, 'force'));
      if (await Promise.race([closed, forced]) === 'force') {
        terminate(child, 'SIGKILL');
        await waitForClose(child);
      }
      return this.snapshot();
    },
  };
}

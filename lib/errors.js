export class GuardianError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GuardianError';
    this.code = code;
    this.details = details;
    this.exitCode = 2;
  }
}

export class CommandError extends GuardianError {
  constructor(result) {
    const reason = result.timedOut
      ? `timed out after ${result.timeoutMs} ms`
      : `exited with code ${result.exitCode ?? 'unknown'}`;
    super('COMMAND_FAILED', `${result.displayCommand} ${reason}`, { result });
    this.result = result;
  }
}

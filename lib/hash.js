import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = input => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) throw new TypeError('cannot stringify a cyclic value');
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(
      Object.keys(input).sort().map(key => [key, normalize(input[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function objectHash(value) {
  return sha256(stableStringify(value));
}

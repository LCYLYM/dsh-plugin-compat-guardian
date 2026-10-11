import WebSocket from 'ws';
import { GuardianError } from './errors.js';

export async function dshRpc(baseUrl, method, payload, cookie) {
  const rpcId = crypto.randomUUID();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new GuardianError('DSH_RPC_TRANSPORT', 'The local DSH RPC transport failed'); }
  if (!response.ok) throw new GuardianError('DSH_RPC_HTTP', `Local DSH RPC returned HTTP ${response.status}`, { status: response.status });
  const body = await response.json().catch(() => null);
  if (body?.rpcId !== rpcId || body?.result?.ok !== true) {
    throw new GuardianError('DSH_RPC_REJECTED', `Local DSH RPC rejected ${method}`, { method, remoteCode: body?.result?.error?.code });
  }
  return body.result.value;
}

// Both probes are read-only. Version numbers do not determine the actual wire
// generation; only a successfully validated response selects a protocol.
export async function sessionTransport(baseUrl, cookie) {
  let legacyError;
  try {
    await dshRpc(baseUrl, 'session.modelCatalog', {}, cookie);
    return { protocol: 'legacy-rpc', call: (method, request) => dshRpc(baseUrl, `session.${method}`, request, cookie) };
  } catch (error) {
    if (error.details?.status === 401 || error.details?.status === 403) throw error;
    legacyError = error;
  }
  try {
    await dshRpc(baseUrl, 'session/modelCatalog', { args: {} }, cookie);
    return { protocol: 'typert-remote', call: (method, request) => dshRpc(baseUrl, `session/${method}`, { args: { request } }, cookie) };
  } catch (error) {
    throw new GuardianError('DSH_SESSION_PROTOCOL_UNSUPPORTED', 'Neither reviewed DSH Session RPC generation responded successfully', {
      legacyCode: legacyError.code, currentCode: error.code,
      legacyRemoteCode: legacyError.details?.remoteCode, currentRemoteCode: error.details?.remoteCode,
      legacyHttpStatus: legacyError.details?.status, currentHttpStatus: error.details?.status,
    });
  }
}

// The new native session/follow contract replaces session.history. Record
// snapshot and append events, and resolve only after the real terminal event.
export function followSessionTurn(baseUrl, sessionId, cookie, timeoutMs = 180_000) {
  const url = new URL('/api/remote.mux', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { headers: cookie ? { cookie } : {}, handshakeTimeout: 10_000 });
  const streamId = crypto.randomUUID();
  const events = [];
  let settled = false;
  let finish;
  const done = new Promise((resolve, reject) => {
    finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve(events);
    };
    const timer = setTimeout(() => finish(new GuardianError('DSH_TURN_DEADLINE', 'DSH did not persist a terminal turn event before the smoke deadline')), timeoutMs);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow',
      payload: { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 20 } } } })));
    socket.on('message', data => {
      try {
        const message = JSON.parse(String(data));
        if (message.streamId !== streamId) return;
        if (message.type === 'error') return finish(new GuardianError('DSH_STREAM_REJECTED', 'The native DSH Session stream was rejected', { remoteCode: message.error?.code }));
        if (message.type === 'end') return finish(new GuardianError('DSH_STREAM_ENDED', 'DSH Session stream ended before a terminal turn event'));
        if (message.type !== 'item') return;
        const frame = message.value;
        if (frame.type === 'snapshot') events.push(...frame.records.filter(entry => entry.type === 'event').map(entry => entry.event));
        else if (frame.type === 'event') events.push(frame.event);
        if (events.some(event => event.type === 'turn/end')) finish();
      } catch { finish(new GuardianError('DSH_STREAM_INVALID', 'DSH returned an invalid Session stream frame')); }
    });
    socket.on('error', () => finish(new GuardianError('DSH_STREAM_TRANSPORT', 'The local DSH Session stream transport failed')));
    socket.on('close', () => { if (!settled) finish(new GuardianError('DSH_STREAM_CLOSED', 'DSH closed the Session stream before a terminal turn event')); });
  });
  return { done, close: () => finish(new GuardianError('DSH_STREAM_CANCELLED', 'DSH Session observation was cancelled')) };
}

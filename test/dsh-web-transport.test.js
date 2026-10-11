import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { dshRpc, sessionTransport, followSessionTurn } from '../lib/dsh-web-transport.js';

async function server(t, handler) {
  const http = createServer(handler);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => new Promise(resolve => http.close(resolve)));
  return { http, url: `http://127.0.0.1:${http.address().port}` };
}
async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text);
}
function reply(res, request, value) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ rpcId: request.rpcId, result: { ok: true, value } }));
}

test('Session transport probes read-only methods then uses exact native named arguments', async t => {
  const requests = [];
  const { url } = await server(t, async (req, res) => {
    const request = await body(req);
    requests.push({ path: req.url, payload: request.payload, cookie: req.headers.cookie });
    if (req.url.includes('session.')) { res.writeHead(404).end(); return; }
    reply(res, request, req.url.endsWith('modelCatalog') ? { groups: [] } : { sessionId: 'native-session' });
  });
  const transport = await sessionTransport(url, 'dsh-session=opaque');
  assert.equal(transport.protocol, 'typert-remote');
  assert.deepEqual(await transport.call('create', { cwd: '/fixture' }), { sessionId: 'native-session' });
  assert.deepEqual(requests.map(item => item.payload), [{}, { args: {} }, { args: { request: { cwd: '/fixture' } } }]);
  assert.ok(requests.every(item => item.cookie === 'dsh-session=opaque'));
});

test('legacy Session RPC keeps flat arguments and never tries the new protocol after success', async t => {
  const requests = [];
  const { url } = await server(t, async (req, res) => {
    const request = await body(req);
    requests.push(request);
    reply(res, request, { sessionId: 'legacy-session' });
  });
  const transport = await sessionTransport(url);
  assert.equal(transport.protocol, 'legacy-rpc');
  await transport.call('create', { cwd: '/fixture' });
  assert.deepEqual(requests.map(item => item.method), ['session.modelCatalog', 'session.create']);
  assert.deepEqual(requests[1].payload, { cwd: '/fixture' });
});

test('auth rejection is not bypassed by protocol fallback', async t => {
  let calls = 0;
  const { url } = await server(t, (req, res) => { calls += 1; res.writeHead(403).end(); });
  await assert.rejects(sessionTransport(url), { code: 'DSH_RPC_HTTP' });
  assert.equal(calls, 1);
});

test('RPC validates correlation and preserves only reviewed rejection metadata', async t => {
  const { url } = await server(t, async (req, res) => {
    const request = await body(req);
    res.end(JSON.stringify({ rpcId: request.rpcId, result: { ok: false, error: { code: 'session/model-unavailable', message: 'untrusted-secret' } } }));
  });
  await assert.rejects(dshRpc(url, 'session/selectModel', {}, ''), error => {
    assert.equal(error.code, 'DSH_RPC_REJECTED');
    assert.deepEqual(error.details, { method: 'session/selectModel', remoteCode: 'session/model-unavailable' });
    assert.doesNotMatch(JSON.stringify(error), /untrusted-secret/);
    return true;
  });
});

test('native follow consumes persisted snapshot and append records and closes at turn/end', async t => {
  const { http, url } = await server(t, (req, res) => res.end());
  const ws = new WebSocketServer({ server: http, path: '/api/remote.mux' });
  t.after(() => ws.close());
  let opened;
  let closed;
  ws.on('connection', socket => {
    closed = once(socket, 'close');
    socket.on('message', raw => {
      opened = JSON.parse(String(raw));
      const send = value => socket.send(JSON.stringify({ type: 'item', streamId: opened.streamId, value }));
      send({ type: 'snapshot', records: [{ type: 'event', event: { type: 'user/message' } }] });
      send({ type: 'event', event: { type: 'turn/end' } });
    });
  });
  const events = await followSessionTurn(url, 'fixture-session', '', 1000).done;
  assert.deepEqual(events.map(item => item.type), ['user/message', 'turn/end']);
  assert.equal(opened.endpoint, 'session/follow');
  assert.deepEqual(opened.payload.args.request.address, { kind: 'session', sessionId: 'fixture-session' });
  await closed;
});

test('a native stream closing without terminal evidence cannot pass', async t => {
  const { http, url } = await server(t, (req, res) => res.end());
  const ws = new WebSocketServer({ server: http, path: '/api/remote.mux' });
  t.after(() => ws.close());
  ws.on('connection', socket => socket.close());
  await assert.rejects(followSessionTurn(url, 'fixture-session', '', 1000).done, { code: 'DSH_STREAM_CLOSED' });
});

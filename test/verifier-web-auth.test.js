import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { establishWebSession } from '../lib/verifier.js';

test('verifier exchanges the DSH launch token for a browser session cookie', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/?token=fixture-launch-token') {
      response.writeHead(302, { location: '/', 'set-cookie': 'dsh_fixture=signed-session; Path=/; HttpOnly' });
      response.end();
      return;
    }
    if (request.headers.cookie === 'dsh_fixture=signed-session') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('authenticated');
      return;
    }
    response.writeHead(401, { 'content-type': 'text/plain' });
    response.end('unauthorized');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const service = {
    exited: false,
    snapshot: () => ({ stdout: `dsh web: ${baseUrl}/?token=fixture-launch-token\n` }),
  };
  try {
    const session = await establishWebSession(baseUrl, service, 2_000);
    assert.equal(session.cookie, 'dsh_fixture=signed-session');
    const response = await fetch(baseUrl, { headers: { cookie: session.cookie } });
    assert.equal(response.status, 200);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('verifier retains compatibility with a tokenless Web surface', async () => {
  const service = {
    exited: false,
    snapshot: () => ({ stdout: 'dsh web: http://127.0.0.1:34567\n' }),
  };
  const session = await establishWebSession('http://127.0.0.1:34567', service, 1_000);
  assert.equal(session.cookie, undefined);
});

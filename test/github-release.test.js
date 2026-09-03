import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { resolveGitHubReleaseSnapshot } from '../lib/registry.js';

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

test('GitHub release watcher selects the newest DSH prerelease and verifies its NPM artifact', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/repos/deepseek-ai/deepseek-harness/releases?per_page=100') {
      return json(response, [
        {
          tag_name: 'dsh-v0.1.1-rc.2',
          target_commitish: 'b'.repeat(40),
          prerelease: true,
          draft: false,
          html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2',
          published_at: '2026-08-21T12:35:08Z',
        },
        {
          tag_name: 'dsh-v0.1.2-rc.1',
          target_commitish: 'a'.repeat(40),
          prerelease: true,
          draft: false,
          html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1',
          published_at: '2026-09-03T06:06:07Z',
        },
      ]);
    }
    if (request.url === '/npm/%40deepseek-ai%2Fdsh') {
      return json(response, {
        'dist-tags': { latest: '0.1.1-rc.2', next: '0.1.2-rc.1' },
        versions: {
          '0.1.2-rc.1': {
            dist: {
              integrity: 'sha512-test',
              shasum: 'test-sha',
              tarball: 'https://registry.example.invalid/dsh-0.1.2-rc.1.tgz',
            },
          },
        },
        time: { '0.1.2-rc.1': '2026-09-03T06:21:52.107Z' },
      });
    }
    return json(response, { error: 'not found' }, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}`;
  try {
    const candidate = await resolveGitHubReleaseSnapshot({
      githubApi: api,
      repository: 'deepseek-ai/deepseek-harness',
      registry: `${api}/npm`,
      packageName: '@deepseek-ai/dsh',
    });
    assert.equal(candidate.version, '0.1.2-rc.1');
    assert.equal(candidate.requested, 'github-release');
    assert.equal(candidate.source, 'github-release');
    assert.equal(candidate.release.tag, 'dsh-v0.1.2-rc.1');
    assert.equal(candidate.release.commit, 'a'.repeat(40));
    assert.equal(candidate.integrity, 'sha512-test');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('GitHub release watcher reports a pending NPM artifact without a fake candidate', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/repos/acme/dsh/releases?per_page=100') {
      return json(response, [{
        tag_name: 'dsh-v0.1.3-rc.1',
        target_commitish: 'c'.repeat(40),
        prerelease: true,
        draft: false,
      }]);
    }
    if (request.url === '/npm/%40deepseek-ai%2Fdsh') return json(response, { 'dist-tags': {}, versions: {} });
    return json(response, {}, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(
      () => resolveGitHubReleaseSnapshot({ githubApi: api, repository: 'acme/dsh', registry: `${api}/npm` }),
      error => error.code === 'NPM_ARTIFACT_PENDING'
        && error.details.release.tag === 'dsh-v0.1.3-rc.1'
        && error.details.release.commit === 'c'.repeat(40),
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});

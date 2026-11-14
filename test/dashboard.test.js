'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server, parseTokens, splitMessage, stopJob } = require('../discord_web');

test('parseTokens removes duplicates and accepts bot-token configuration', () => {
  assert.deepEqual(parseTokens(' abc , def , abc '), ['abc', 'def']);
  assert.deepEqual(parseTokens('["one","two"]'), ['one', 'two']);
  assert.deepEqual(parseTokens(''), []);
  assert.throws(() => parseTokens('{"token":"x"}'));
});

test('splitMessage preserves newlines, supports unicode and rejects large drafts', () => {
  assert.deepEqual(splitMessage('Xin chào\nDòng 2'), ['Xin chào\nDòng 2']);
  const text = '🌤️'.repeat(900) + '\n' + 'abc'.repeat(700);
  const chunks = splitMessage(text);
  assert.equal(chunks.join(''), text);
  for (const item of chunks) assert.ok(Array.from(item).length <= 1850);
  assert.deepEqual(splitMessage('   \n  '), []);
  assert.deepEqual(splitMessage('x'.repeat(8001)), []);
});

test('stopJob changes state and aborts outstanding requests', () => {
  const job = { status: 'running', controller: new AbortController() };
  stopJob(job);
  assert.equal(job.status, 'stopped');
  assert.equal(job.controller.signal.aborted, true);
  stopJob(job);
  assert.equal(job.status, 'stopped');
});

test('API requires authentication; no personal token endpoint exists', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const routes = ['/api/accounts', '/api/channels?account=123', '/api/jobs', '/api/token'];
    for (const route of routes) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 401);
    }
    const health = await fetch(origin + '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

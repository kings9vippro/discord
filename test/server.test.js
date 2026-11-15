'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { test } = require('node:test');

const password = 'dev-test-admin-password';
const secret = 'dev-test-secret-for-local-integration-only';

async function startServer(t, sessionSecret = secret, adminPassword = password) {
  const child = spawn(process.execPath, ['discord_web.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', ADMIN_PASSWORD: adminPassword, SESSION_SECRET: sessionSecret },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exit = once(child, 'exit');
  async function stop() {
    child.kill();
    await exit;
  }
  t.after(stop);

  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  const port = await Promise.race([
    once(lines, 'line').then(([line]) => /^Listening on port (\d+)$/.exec(line)?.[1]),
    exit.then(([code, signal]) => { throw Error(`Server exited before listening (${code || signal})`); }),
  ]);
  assert.ok(port);

  return {
    request: (path, options) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...options }),
    stop,
  };
}

function login(server, password, remember = false) {
  return server.request('/api/login', {
    method: 'POST',
    body: new URLSearchParams({ password, ...(remember ? { remember: 'yes' } : {}) }),
  });
}

function sessionHeaders(response) {
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-discord-admin=/);
  assert.match(cookie, /; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
  return { cookie: cookie.split(';')[0] };
}

test('health is public and uncached while admin requires authentication', { timeout: 8000 }, async t => {
  const server = await startServer(t);
  const health = await server.request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok' });

  const head = await server.request('/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await server.request('/api/logout', { method: 'POST' })).status, 401);
  assert.match(await (await server.request('/')).text(), /Đăng nhập quản trị/);
  assert.equal((await login(server, 'wrong-password')).status, 401);

  const response = await login(server, password);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.get('set-cookie'), /Max-Age=28800/);
  const headers = sessionHeaders(response);
  assert.match(await (await server.request('/', { headers })).text(), /Bạn đã đăng nhập/);

  const tampered = headers.cookie.replace(/.$/, char => char === '0' ? '1' : '0');
  assert.match(await (await server.request('/', { headers: { cookie: tampered } })).text(), /Đăng nhập quản trị/);
});

test('remembered session survives a restart and logout revokes it in the current process', { timeout: 8000 }, async t => {
  const first = await startServer(t);
  const response = await login(first, password, true);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /Max-Age=2592000/);
  const headers = sessionHeaders(response);
  await first.stop();

  const restarted = await startServer(t);
  assert.match(await (await restarted.request('/', { headers })).text(), /Bạn đã đăng nhập/);
  const logout = await restarted.request('/api/logout', { method: 'POST', headers });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /^__Host-discord-admin=;.*Max-Age=0/);
  assert.match(await (await restarted.request('/', { headers })).text(), /Đăng nhập quản trị/);

  const rotated = await startServer(t, secret + '-rotated');
  assert.match(await (await rotated.request('/', { headers })).text(), /Đăng nhập quản trị/);
  const changedPassword = await startServer(t, secret, password + '-changed');
  assert.match(await (await changedPassword.request('/', { headers })).text(), /Đăng nhập quản trị/);
});

test('remember-device is unavailable without a stable secret', { timeout: 8000 }, async t => {
  const first = await startServer(t, '');
  assert.doesNotMatch(await (await first.request('/')).text(), /Ghi nhớ thiết bị/);
  const response = await login(first, password, true);
  assert.match(response.headers.get('set-cookie'), /Max-Age=28800/);
  const headers = sessionHeaders(response);

  const restarted = await startServer(t, '');
  assert.match(await (await restarted.request('/', { headers })).text(), /Đăng nhập quản trị/);
});

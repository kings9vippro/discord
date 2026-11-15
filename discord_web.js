'use strict';

const http = require('node:http');
const { createHmac, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const port = Number(process.env.PORT || 10000);
const password = process.env.ADMIN_PASSWORD;
const secret = process.env.SESSION_SECRET;
const production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

if (!password || (production && password.length < 12)) {
  console.error('Set ADMIN_PASSWORD to a strong password (at least 12 characters in production).');
  process.exit(1);
}
if (secret && Buffer.byteLength(secret) < 32) {
  console.error('SESSION_SECRET must be at least 32 bytes.');
  process.exit(1);
}

const hour = 3600;
const standardTtl = 8 * hour;
const rememberedTtl = 30 * 24 * hour;
const cookieName = production ? '__Host-discord-admin' : 'discord-admin';
const passwordSalt = randomBytes(16);
const passwordHash = scryptSync(password, passwordSalt, 64);
const signingKey = scryptSync(password, secret || randomBytes(32), 32);
const revoked = new Map();
const loginWindow = 15 * 60 * 1000;
let failures = 0;
let resetAt = 0;

function cookie(value, maxAge) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
}

function signature(payload) {
  return createHmac('sha256', signingKey).update('discord-admin:v1:').update(payload).digest();
}

function newSession(ttl) {
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${randomBytes(32).toString('hex')}.${expires}`;
  return cookie(`${payload}.${signature(payload).toString('hex')}`, ttl);
}

function currentSession(req) {
  const prefix = cookieName + '=';
  const value = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(prefix))?.slice(prefix.length);
  const match = /^([a-f0-9]{64})\.(\d{1,12})\.([a-f0-9]{64})$/.exec(value || '');
  if (!match) return null;

  const [, id, expiryText, mac] = match;
  const expires = Number(expiryText);
  if (expires <= Date.now() / 1000 || revoked.has(id)) return null;
  if (!timingSafeEqual(signature(`${id}.${expiryText}`), Buffer.from(mac, 'hex'))) return null;
  return { id, expires };
}

setInterval(() => {
  for (const [id, expires] of revoked) {
    if (expires <= Date.now() / 1000) revoked.delete(id);
  }
}, 60_000).unref();

function page(session, error = '') {
  const remember = secret
    ? '<label class="remember"><input type="checkbox" name="remember" value="yes"> Ghi nhớ thiết bị trong 30 ngày</label>'
    : '';
  const content = session
    ? '<h2>Quản trị</h2><p>Bạn đã đăng nhập.</p><form method="post" action="/api/logout"><button>Đăng xuất</button></form>'
    : `<h2>Đăng nhập quản trị</h2><form method="post" action="/api/login">
      <label for="password">Mật khẩu quản trị</label>
      <input id="password" name="password" type="password" required autocomplete="current-password" maxlength="1024">
      ${remember}<button>Đăng nhập</button></form>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Discord | Phan Anh Khôi</title>
    <style>
      *{box-sizing:border-box}body{margin:0;color:#111;background:#fff;font:16px system-ui,sans-serif}
      main{max-width:480px;margin:12vh auto 0;padding:0 20px}h1{margin-bottom:0}
      .credit{color:#555;margin-top:8px}section{border:1px solid #ddd;border-radius:14px;padding:24px}
      h2{font-size:20px;margin-top:0}label{display:block;margin-bottom:8px}
      input,button{font:inherit}input[type=password]{width:100%;padding:10px;border:1px solid #aaa;border-radius:8px}
      .remember{margin:14px 0}button{color:#fff;background:#111;border:1px solid #111;border-radius:8px;padding:10px 16px;margin-top:12px;cursor:pointer}
      [role=alert]{color:#a00}
    </style></head><body><main><h1>Discord</h1><p class="credit">Phan Anh Khôi</p>
    <section>${content}${error ? `<p role="alert">${error}</p>` : ''}</section>
    </main></body></html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function html(res, status, session, error) {
  send(res, status, page(session, error), {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
}

function redirect(res, sessionCookie) {
  send(res, 303, '', { Location: '/', 'Set-Cookie': sessionCookie });
}

async function readLogin(req) {
  let size = 0;
  const parts = [];
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length;
    if (size > 16_384) {
      req.resume();
      return null;
    }
    parts.push(part);
  }
  return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}

async function login(req, res) {
  const params = await readLogin(req);
  const submitted = params?.get('password');
  if (!submitted || submitted.length > 1024) {
    return html(res, 400, null, 'Dữ liệu đăng nhập không hợp lệ.');
  }

  const now = Date.now();
  if (now >= resetAt) {
    failures = 0;
    resetAt = now + loginWindow;
  }
  if (failures >= 5) {
    return html(res, 429, null, 'Quá nhiều lần thử. Vui lòng thử lại sau ít phút.');
  }

  if (!timingSafeEqual(scryptSync(submitted, passwordSalt, 64), passwordHash)) {
    failures++;
    return html(res, 401, null, 'Mật khẩu không đúng.');
  }

  failures = 0;
  resetAt = 0;
  const ttl = secret && params.get('remember') === 'yes' ? rememberedTtl : standardTtl;
  redirect(res, newSession(ttl));
}

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?', 1)[0];
  if (path === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    return send(res, 200, '{"status":"ok"}', { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const session = currentSession(req);
  if (path === '/' && req.method === 'GET') return html(res, 200, session);
  if (path === '/api/login' && req.method === 'POST') {
    try {
      return await login(req, res);
    } catch {
      return html(res, 400, null, 'Không đọc được dữ liệu đăng nhập.');
    }
  }
  if (path === '/api/logout' && req.method === 'POST') {
    if (!session) return send(res, 401, 'Cần đăng nhập');
    revoked.set(session.id, session.expires);
    return redirect(res, cookie('', 0));
  }

  return send(res, session ? 404 : 401, session ? 'Không tìm thấy' : 'Cần đăng nhập');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Listening on port ${server.address().port}`);
});

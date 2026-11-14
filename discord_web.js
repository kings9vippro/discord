'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const API = 'https://discord.com/api/v10';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 16 * 1024;
const MAX_CHANNELS = 25;
const MAX_DRAFT_CHARS = 8000;
const MIN_REQUEST_GAP_MS = 1750;
const BOT_GUILD_IDS = [...new Set((process.env.DISCORD_GUILD_IDS || '').split(',').map(x => x.trim()).filter(x => /^\d{17,22}$/.test(x)))];
const sessions = new Map();
const attempts = new Map();
const bots = new Map();
const jobs = new Map();
const channelCache = new Map();

function parseTokens(value) {
  if (!value || !String(value).trim()) return [];
  const raw = String(value).trim();
  let list;
  if (raw.startsWith('[')) {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) throw Error('DISCORD_BOT_TOKENS phải là một mảng JSON.');
  } else {
    list = raw.split(/[\n,]/);
  }
  return [...new Set(list.map(x => String(x).trim()).filter(Boolean))].slice(0, 10);
}
function splitMessage(value) {
  if (typeof value !== 'string') return [];
  const chars = Array.from(value.replace(/\r\n?/g, '\n'));
  if (!chars.some(c => !/\s/.test(c)) || chars.length > MAX_DRAFT_CHARS) return [];
  const parts = [];
  for (let at = 0; at < chars.length;) {
    let end = Math.min(at + 1850, chars.length);
    if (end < chars.length) {
      const offset = chars.slice(at, end).lastIndexOf('\n');
      if (offset >= 900) end = at + offset + 1;
    }
    parts.push(chars.slice(at, end).join(''));
    at = end;
  }
  return parts;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('Đã dừng tác vụ'));
    if (ms <= 0) return resolve();
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(Error('Đã dừng tác vụ')); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
function hash(value) { return createHash('sha256').update(String(value)).digest(); }
function equal(a, b) { return timingSafeEqual(hash(a), hash(b)); }
function fail(status, message) { const err = Error(message); err.httpStatus = status; return err; }

async function rateGate(bot, signal) {
  const slot = bot.pending.then(async () => {
    await sleep(Math.max(0, bot.nextAt - Date.now()), signal);
    bot.nextAt = Date.now() + MIN_REQUEST_GAP_MS;
  });
  bot.pending = slot.catch(() => {});
  await slot;
}
async function discordRequest(bot, method, route, data, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await rateGate(bot, signal);
    const timeout = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(API + route, {
      method,
      headers: {
        Authorization: 'Bot ' + bot.token,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: data == null ? undefined : JSON.stringify(data),
      signal: combined
    });
    if (response.status === 429) {
      const limits = await response.json().catch(() => ({}));
      const seconds = Number(limits.retry_after);
      const wait = Number.isFinite(seconds) ? Math.min(120000, Math.max(1000, seconds * 1000)) : 5000;
      bot.nextAt = Math.max(bot.nextAt, Date.now() + wait);
      if (attempt < 2) continue;
      throw fail(429, 'Discord đang giới hạn tốc độ. Tác vụ dừng thay vì gửi dồn.');
    }
    if (!response.ok) {
      const reason = String(await response.text().catch(() => '')).slice(0, 160);
      throw fail(response.status, 'Discord HTTP ' + response.status + (reason ? ': ' + reason : ''));
    }
    if (response.status === 204) return null;
    return response.json();
  }
}

async function initializeBots() {
  const tokens = parseTokens(process.env.DISCORD_BOT_TOKENS || process.env.DISCORD_BOT_TOKEN || '');
  for (let i = 0; i < tokens.length; i++) {
    const bot = { token: tokens[i], nextAt: 0, pending: Promise.resolve() };
    try {
      const user = await discordRequest(bot, 'GET', '/users/@me');
      if (!user || user.bot !== true || !/^\d{17,22}$/.test(String(user.id))) {
        throw Error('Chỉ chấp nhận token của ứng dụng bot Discord chính thức.');
      }
      bot.id = String(user.id);
      bot.name = String(user.global_name || user.username || bot.id);
      bot.username = String(user.username || bot.id);
      bots.set(bot.id, bot);
    } catch (error) {
      console.error('Discord application #' + (i + 1) + ' unavailable: ' + error.message.replace(tokens[i], '[REDACTED]'));
    }
  }
}
async function loadChannels(bot) {
  const cached = channelCache.get(bot.id);
  if (cached && cached.expires > Date.now()) return cached.channels;
  const channels = [];
  for (const id of BOT_GUILD_IDS) {
    try {
      const [guild, raw] = await Promise.all([
        discordRequest(bot, 'GET', '/guilds/' + id),
        discordRequest(bot, 'GET', '/guilds/' + id + '/channels')
      ]);
      if (!Array.isArray(raw)) continue;
      for (const channel of raw) {
        if ((channel.type === 0 || channel.type === 5) && /^\d{17,22}$/.test(String(channel.id))) {
          channels.push({ id: String(channel.id), name: String(guild.name || id) + ' / #' + String(channel.name || channel.id) });
        }
      }
    } catch (error) {
      console.error('Cannot list guild ' + id + ' for application ' + bot.id + ': HTTP ' + (error.httpStatus || 'network'));
    }
  }
  channels.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  channelCache.set(bot.id, { channels, expires: Date.now() + 60_000 });
  return channels;
}
function publicJob(job) {
  return {
    id: job.id, account: job.account, accountName: job.accountName, channels: job.channels,
    status: job.status, sent: job.sent, total: job.total,
    failed: job.failed, errors: job.errors.slice(-8),
    createdAt: job.createdAt, updatedAt: job.updatedAt
  };
}
async function executeJob(job) {
  const bot = bots.get(job.account);
  let position = 0;
  const worker = async () => {
    while (job.status === 'running') {
      const channel = job.channels[position++];
      if (!channel) return;
      for (const part of job.parts) {
        if (job.status !== 'running') return;
        try {
          await discordRequest(bot, 'POST', '/channels/' + channel + '/messages', {
            content: part,
            allowed_mentions: { parse: [] }
          }, job.controller.signal);
          job.sent++;
          job.updatedAt = new Date().toISOString();
        } catch (error) {
          if (job.status !== 'running') return;
          job.failed++;
          job.errors.push({ channel, reason: error.message.slice(0, 220) });
          job.updatedAt = new Date().toISOString();
          if (error.httpStatus === 401 || error.httpStatus === 429) {
            job.status = 'failed';
            job.controller.abort();
            return;
          }
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, job.channels.length) }, worker));
  if (job.status === 'running') job.status = job.failed ? 'completed_with_errors' : 'completed';
  job.updatedAt = new Date().toISOString();
}
function stopJob(job) {
  if (job.status === 'running') {
    job.status = 'stopped';
    job.updatedAt = new Date().toISOString();
    job.controller.abort();
  }
}
function json(res, status, value, cookie) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(cookie ? { 'Set-Cookie': cookie } : {})
  });
  res.end(JSON.stringify(value));
}
function cookieValue(req) {
  const id = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const data = id && sessions.get(id);
  if (!data) return null;
  if (data.expires < Date.now()) { sessions.delete(id); return null; }
  return id;
}
function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const pieces = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(fail(413, 'Dữ liệu quá lớn')); req.destroy(); return; }
      pieces.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(pieces).toString('utf8') || '{}')); }
      catch { reject(fail(400, 'JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}
function staticFile(res, name, type) {
  const contents = fs.readFileSync(path.join(__dirname, 'public', name));
  res.writeHead(200, {
    'Content-Type': type, 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  });
  res.end(contents);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (req.method === 'GET' && route === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && route === '/') return staticFile(res, 'index.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && route === '/app.js') return staticFile(res, 'app.js', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && route === '/style.css') return staticFile(res, 'style.css', 'text/css; charset=utf-8');
    if (req.method !== 'GET' && req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
        return json(res, 403, { error: 'Nguồn yêu cầu không hợp lệ' });
      }
    }
    if (route === '/api/login' && req.method === 'POST') {
      if (ADMIN_PASSWORD.length < 12) return json(res, 503, { error: 'Chưa cấu hình ADMIN_PASSWORD trên Render' });
      const address = req.socket.remoteAddress || 'unknown';
      const entry = attempts.get(address) || { count: 0, until: 0 };
      if (entry.until > Date.now()) return json(res, 429, { error: 'Đăng nhập bị khóa tạm thời' });
      const body = await bodyJson(req);
      if (!equal(String(body.password || ''), ADMIN_PASSWORD)) {
        entry.count += 1;
        if (entry.count >= 5) { entry.count = 0; entry.until = Date.now() + 15 * 60_000; }
        attempts.set(address, entry);
        return json(res, 401, { error: 'Sai mật khẩu quản trị' });
      }
      attempts.delete(address);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { expires: Date.now() + 8 * 3_600_000 });
      return json(res, 200, { ok: true }, 'session=' + id + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800');
    }
    const session = cookieValue(req);
    if (!session) return json(res, 401, { error: 'Cần đăng nhập quản trị' });
    if (req.method === 'POST' && route === '/api/logout') {
      sessions.delete(session);
      return json(res, 200, { ok: true }, 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    }
    if (req.method === 'GET' && route === '/api/accounts') {
      return json(res, 200, { accounts: [...bots.values()].map(b => ({ id: b.id, name: b.name, username: b.username })) });
    }
    if (req.method === 'GET' && route === '/api/channels') {
      const bot = bots.get(url.searchParams.get('account'));
      if (!bot) return json(res, 400, { error: 'Ứng dụng Discord chưa được kết nối' });
      return json(res, 200, { channels: await loadChannels(bot) });
    }
    if (req.method === 'GET' && route === '/api/jobs') {
      const account = url.searchParams.get('account');
      const data = [...jobs.values()].filter(j => !account || j.account === account).reverse();
      return json(res, 200, { jobs: data.map(publicJob) });
    }
    if (req.method === 'POST' && route === '/api/jobs') {
      const body = await bodyJson(req);
      const bot = bots.get(String(body.account || ''));
      const channels = Array.isArray(body.channels) ? [...new Set(body.channels.map(String))] : [];
      const parts = splitMessage(body.content);
      if (!bot) return json(res, 400, { error: 'Chọn ứng dụng Discord hợp lệ' });
      if (channels.length === 0 || channels.length > MAX_CHANNELS || channels.some(c => !/^\d{17,22}$/.test(c))) {
        return json(res, 400, { error: 'Chọn từ 1 đến 25 kênh hợp lệ' });
      }
      if (!parts.length) return json(res, 400, { error: 'Nội dung trống hoặc vượt 8.000 ký tự' });
      const permitted = new Set((await loadChannels(bot)).map(c => c.id));
      if (channels.some(c => !permitted.has(c))) return json(res, 403, { error: 'Kênh không thuộc máy chủ đã cấu hình cho ứng dụng' });
      if ([...jobs.values()].filter(j => j.status === 'running').length >= 12) {
        return json(res, 429, { error: 'Đang có 12 tác vụ, hãy chờ hoặc dừng một tác vụ' });
      }
      const stamp = new Date().toISOString();
      const job = {
        id: randomBytes(8).toString('hex'), account: bot.id, accountName: bot.name,
        channels, parts, sent: 0, total: channels.length * parts.length, failed: 0,
        errors: [], status: 'running', createdAt: stamp, updatedAt: stamp,
        controller: new AbortController()
      };
      jobs.set(job.id, job);
      if (jobs.size > 200) {
        for (const [id, old] of jobs) {
          if (old.status !== 'running') jobs.delete(id);
          if (jobs.size <= 180) break;
        }
      }
      void executeJob(job).catch(error => {
        job.errors.push({ channel: 'system', reason: error.message.slice(0, 220) });
        if (job.status === 'running') job.status = 'failed';
        job.updatedAt = new Date().toISOString();
      });
      return json(res, 201, { job: publicJob(job) });
    }
    const match = route.match(/^\/api\/jobs\/([a-f0-9]{16})\/stop$/);
    if (req.method === 'POST' && match) {
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { error: 'Không tìm thấy tác vụ' });
      stopJob(job);
      return json(res, 200, { job: publicJob(job) });
    }
    return json(res, 404, { error: 'Không tìm thấy đường dẫn' });
  } catch (error) {
    console.error('Request failure:', error.httpStatus || error.name || 'Error');
    return json(res, error.httpStatus && error.httpStatus < 500 ? error.httpStatus : 502,
      { error: error.httpStatus ? error.message : 'Yêu cầu thất bại. Kiểm tra cấu hình hoặc kết nối Discord.' });
  }
});
if (require.main === module) {
  initializeBots().then(() => server.listen(PORT, '0.0.0.0', () => console.log('Discord dashboard on port ' + PORT)))
    .catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
}
module.exports = { server, parseTokens, splitMessage, stopJob, jobs, bots, initializeBots };

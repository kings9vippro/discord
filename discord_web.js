'use strict';
const http = require('node:http');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

let ProxyAgent, fetch;
try {
  ({ ProxyAgent } = require('proxy-agent'));
  fetch = require('node-fetch');
} catch (e) {
  console.error('Missing deps. Run: npm install proxy-agent node-fetch');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 10000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
const PASSWORD_SALT = process.env.PASSWORD_SALT || randomBytes(16).toString('hex');
const PASSWORD_HASH = scryptSync(ADMIN_PASSWORD, PASSWORD_SALT, 64);

const WARMUP_TOTAL_MS = Math.max(15000, Number(process.env.WARMUP_MS || 90000));
const PACING_MIN_MS = Math.max(20, Number(process.env.PACING_MIN_MS || 30));
const PACING_MAX_MS = Math.max(PACING_MIN_MS, Number(process.env.PACING_MAX_MS || 100));
const ACCOUNT_CONCURRENCY = Math.max(1, Math.min(20, Number(process.env.ACCOUNT_CONCURRENCY || 8)));

// ---------------- proxy pool ----------------
// Fallback: dùng list mày đưa nếu env PROXY_URLS không set.
const DEFAULT_PROXY_LIST = [
  'socks5://171.234.162.57:1083',
  'http://123.25.21.59:8080',
  'socks4://113.22.144.47:1080',
  'https://157.66.81.25:8443',
  'https://123.31.29.158:443',
  'https://14.225.19.28:8443',
  'https://14.225.71.128:443',
  'socks5://27.74.13.188:7001',
  'socks4://1.52.7.73:1080',
  'http://103.161.16.194:60099',
  'socks5://116.101.73.161:1085',
  'http://14.225.240.23:8562',
  'http://103.21.150.15:3128',
  'http://42.96.12.16:55555',
  'socks5://103.182.22.51:9000',
  'socks4://160.30.113.24:1080',
  'socks5://103.182.22.25:9000',
  'socks4://42.116.49.134:1080',
  'socks4://103.182.22.244:9000',
  'http://119.17.211.204:8080',
  'socks5://103.182.22.244:9000',
  'socks4://118.70.131.249:1080',
  'http://171.225.157.118:1080',
];

const PROXY_LIST = (process.env.PROXY_URLS
  ? process.env.PROXY_URLS.split(',')
  : DEFAULT_PROXY_LIST
).map(s => s.trim()).filter(Boolean);

const proxyState = new Map();
PROXY_LIST.forEach(url => proxyState.set(url, {
  agent: null, healthy: null, cooldownUntil: 0, failCount: 0, lastCheck: 0,
}));

function getAgent(url) {
  const st = proxyState.get(url);
  if (!st) return null;
  if (!st.agent) {
    try { st.agent = new ProxyAgent(url); }
    catch (e) { st.healthy = false; return null; }
  }
  return st.agent;
}

function pickProxy(exclude) {
  const now = Date.now();
  const candidates = [];
  for (const [url, st] of proxyState) {
    if (url === exclude) continue;
    if (st.cooldownUntil > now) continue;
    if (st.healthy === false) continue;
    candidates.push(url);
  }
  if (!candidates.length) {
    for (const [url, st] of proxyState) {
      if (url !== exclude && st.cooldownUntil && st.cooldownUntil <= now) {
        st.cooldownUntil = 0;
      }
    }
    const all = PROXY_LIST.filter(u => u !== exclude);
    return all.length ? all[Math.floor(Math.random() * all.length)] : null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function markProxyOk(url) {
  const st = proxyState.get(url);
  if (!st) return;
  st.healthy = true;
  st.failCount = 0;
  st.cooldownUntil = 0;
}

function markProxyConnFail(url) {
  const st = proxyState.get(url);
  if (!st) return;
  st.failCount++;
  if (st.failCount >= 2) st.healthy = false;
  st.cooldownUntil = Date.now() + 60000;
}

async function healthCheck(url, timeoutMs = 8000) {
  const st = proxyState.get(url);
  const agent = getAgent(url);
  if (!agent) return false;
  st.lastCheck = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch('https://discord.com/api/v10/gateway', {
      agent, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) { markProxyOk(url); return true; }
    st.healthy = false;
    st.cooldownUntil = Date.now() + 300000;
    return false;
  } catch {
    st.healthy = false;
    st.cooldownUntil = Date.now() + 300000;
    return false;
  }
}

async function healthCheckAll() {
  if (!PROXY_LIST.length) return { healthy: 0, total: 0 };
  console.log(`[proxy] health-checking ${PROXY_LIST.length} proxies...`);
  const results = await Promise.all(PROXY_LIST.map(u => healthCheck(u).catch(() => false)));
  const healthy = results.filter(Boolean).length;
  console.log(`[proxy] ${healthy}/${PROXY_LIST.length} healthy`);
  for (const [url, st] of proxyState) {
    console.log(`  ${st.healthy ? '✓' : '✗'} ${url}`);
  }
  return { healthy, total: PROXY_LIST.length };
}

// ---------------- fingerprint ----------------
const FP_BUILDS = ['289438', '286288', '285714', '283151'];
const FP_LOCALES = ['vi', 'en-US', 'en-GB'];
const FP_OS = ['Windows', 'Mac OS X', 'Linux'];
const FP_VER = ['126.0.0.0', '125.0.0.0', '127.0.0.0', '128.0.0.0'];

function makeFingerprint(seed) {
  const h = Buffer.from(seed).readUInt32BE(0);
  const pick = (a) => a[h % a.length];
  const os = pick(FP_OS);
  const browserVersion = pick(FP_VER);
  const build = pick(FP_BUILDS);
  const locale = pick(FP_LOCALES);
  const uaOs = os === 'Windows' ? 'Windows NT 10.0; Win64; x64'
             : os === 'Mac OS X' ? 'Macintosh; Intel Mac OS X 10_15_7'
             : 'X11; Linux x86_64';
  const userAgent = `Mozilla/5.0 (${uaOs}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
  const superProps = {
    os, browser: 'Chrome', device: '', system_locale: locale,
    browser_user_agent: userAgent, browser_version: browserVersion,
    os_version: os === 'Windows' ? '10' : os === 'Mac OS X' ? '10.15.7' : '',
    release_channel: 'stable', client_build_number: Number(build),
    client_event_source: null,
  };
  return {
    os, browserVersion, locale, userAgent,
    'X-Super-Properties': Buffer.from(JSON.stringify(superProps)).toString('base64'),
    'X-Discord-Locale': locale,
    'Accept-Language': `${locale},en;q=0.9`,
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/channels/@me',
  };
}

// ---------------- Discord transport (proxy rotating) ----------------
async function discordFetch(path, account, options = {}) {
  const fp = account.fingerprint;
  const headers = {
    'Authorization': account.token,
    'User-Agent': fp.userAgent,
    'X-Super-Properties': fp['X-Super-Properties'],
    'X-Discord-Locale': fp['X-Discord-Locale'],
    'Accept-Language': fp['Accept-Language'],
    'Accept': '*/*',
    'Origin': fp.Origin,
    'Referer': fp.Referer,
    'Priority': 'u=1, i',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...(options.headers || {}),
  };
  if (options.json) headers['Content-Type'] = 'application/json';

  const proxyUrl = options.proxyUrl || pickProxy(options.excludeProxy);
  const agent = proxyUrl ? getAgent(proxyUrl) : null;

  const fetchOpts = {
    method: options.method || 'GET',
    headers,
    body: options.json ? JSON.stringify(options.json) : undefined,
    timeout: 20000,
    redirect: 'manual',
  };
  if (agent) fetchOpts.agent = agent;

  let response;
  try {
    response = await fetch(`https://discord.com/api/v10${path}`, fetchOpts);
    if (proxyUrl) markProxyOk(proxyUrl);
  } catch (e) {
    if (proxyUrl) {
      markProxyConnFail(proxyUrl);
      // Retry once through a different proxy
      if ((options.retries ?? 5) > 0) {
        return discordFetch(path, account, {
          ...options,
          excludeProxy: proxyUrl,
          retries: (options.retries ?? 5) - 1,
        });
      }
    }
    throw new Error(`Connection failed${proxyUrl ? ' via ' + proxyUrl : ''}: ${e.message}`);
  }

  if (response.status === 429 && (options.retries ?? 10) > 0) {
    const body = await response.json().catch(() => ({}));
    const wait = Math.max(20, Math.ceil(Number(body.retry_after || 1) * 1000));
    await new Promise(r => setTimeout(r, wait));
    return discordFetch(path, account, { ...options, retries: (options.retries ?? 10) - 1 });
  }

  if (!response.ok) {
    const text = String(await response.text()).slice(0, 240);
    const err = new Error(`Discord HTTP ${response.status}: ${text}`);
    err.status = response.status;
    throw err;
  }
  if (response.status === 204) return null;
  return response.json();
}

// ---------------- warm-up ----------------
async function warmLogin(account) {
  const steps = [
    { path: '/users/@me', delay: 0 },
    { path: '/users/@me/settings', delay: 8000 },
    { path: '/users/@me/guilds?limit=1', delay: 12000 },
    { path: '/users/@me/guilds?limit=200', delay: 20000 },
    { path: '/users/@me/channels', delay: 20000 },
  ];
  const totalSteps = steps.reduce((a, s) => a + s.delay, 0);
  const extra = Math.max(0, WARMUP_TOTAL_MS - totalSteps);
  let me = null;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].delay > 0) await new Promise(r => setTimeout(r, steps[i].delay));
    try {
      const res = await discordFetch(steps[i].path, account);
      if (i === 0) me = res;
    } catch (e) {
      if (e.status === 401) throw new Error('Token bị Discord thu hồi (401)');
    }
  }
  if (extra > 0) await new Promise(r => setTimeout(r, extra));
  account.warmupUntil = Date.now();
  return me;
}

// ---------------- splitter ----------------
function cleanMessage(s) {
  const text = String(s || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const chars = Array.from(text), parts = [];
  while (chars.length) {
    let take = Math.min(1800, chars.length);
    if (take < chars.length) {
      const breakAt = chars.slice(0, take).lastIndexOf('\n');
      if (breakAt > take / 2) take = breakAt + 1;
    }
    parts.push(chars.splice(0, take).join(''));
  }
  return parts;
}

function pacingMs() {
  return PACING_MIN_MS + Math.random() * (PACING_MAX_MS - PACING_MIN_MS);
}

// ---------------- job runner ----------------
async function runJob(job) {
  job.endedAt = null;
  const session = sessions.get(job.session);
  if (!session) { job.status = 'failed'; job.lastError = 'Phiên đã hết'; job.endedAt = Date.now(); return; }
  const account = session.accounts.find(a => a.id === job.account);
  if (!account) { job.status = 'failed'; job.lastError = 'Token đã xóa'; job.endedAt = Date.now(); return; }

  const wait = (account.warmupUntil || 0) - Date.now();
  if (wait > 0) {
    job.status = 'warming';
    await new Promise(r => setTimeout(r, wait));
    if (job.status !== 'warming') { job.endedAt = Date.now(); return; }
    job.status = 'running';
  }

  let lineIdx = 0;
  const inflight = new Set();

  const dispatch = () => {
    if (job.status !== 'running') return null;
    const channel = job.channels[job.channelIdx % job.channels.length];
    job.channelIdx = (job.channelIdx + 1) % job.channels.length;

    const line = job.lines[lineIdx % job.lines.length];
    lineIdx++;
    const content = line
      + (job.mentions.length ? ' ' + job.mentions.map(x => `<@${x}>`).join(' ') : '')
      + (job.everyone ? ' @everyone' : '');

    const p = (async () => {
      try {
        await discordFetch(`/channels/${channel}/messages`, account, {
          method: 'POST',
          json: {
            content,
            allowed_mentions: {
              parse: job.everyone ? ['everyone'] : [],
              users: job.mentions,
            },
          },
        });
        job.sent++;
        job.lastChannel = channel;
        job.lastError = '';
      } catch (e) {
        job.lastError = e.message;
        if (e.status === 401 || e.status === 403) {
          job.status = 'failed';
        }
      }
    })().finally(() => inflight.delete(p));

    inflight.add(p);
    return p;
  };

  while (job.status === 'running') {
    while (job.status === 'running' && inflight.size < job.concurrency && job.channels.length) {
      dispatch();
      await new Promise(r => setTimeout(r, pacingMs()));
    }
    if (job.status !== 'running') break;

    if (!job.continuous) {
      await Promise.allSettled(inflight);
      job.status = 'completed';
      break;
    }

    await Promise.race([
      ...inflight,
      new Promise(r => setTimeout(r, 500)),
    ]);
  }

  await Promise.allSettled(inflight);
  if (job.status === 'running') job.status = 'completed';
  job.endedAt = Date.now();
}

async function runBatch(list) {
  await Promise.all(list.map(j => runJob(j).catch(e => {
    j.status = 'failed';
    j.lastError = e.message;
    j.endedAt = Date.now();
  })));
}

function publicJob(j) {
  return {
    id: j.id, account: j.account, accountName: j.accountName,
    status: j.status, sent: j.sent,
    channelCount: j.channels.length, channelIdx: j.channelIdx,
    startIndex: j.startIndex, concurrency: j.concurrency,
    lastChannel: j.lastChannel, lastError: j.lastError,
    continuous: j.continuous,
  };
}

function stopJob(job) {
  if (job.status === 'running' || job.status === 'warming') {
    job.status = 'stopped';
    job.endedAt = Date.now();
  }
}

// ---------------- HTML ----------------
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Discord | Phan Anh Khôi</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fff}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:50px auto;padding:0 20px}h1{font-size:32px;letter-spacing:-.04em}h2{font-size:19px;margin-top:0}.muted{color:#555;line-height:1.5}.card{border:1px solid #ddd;border-radius:14px;padding:24px;margin:18px 0}.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1}label{display:block;font-size:14px;font-weight:600;margin:14px 0 5px}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;padding:11px;border:1px solid #aaa;border-radius:8px;color:#111;background:#fff}textarea{min-height:96px;resize:vertical}button{background:#111;color:#fff;border:1px solid #111;border-radius:8px;padding:10px 15px;cursor:pointer;margin-top:14px}button.secondary{background:#fff;color:#111}button.danger{background:#a00;border-color:#a00}button:disabled{opacity:.5;cursor:default}#error{white-space:pre-wrap;color:#a00}#jobs>div{border-top:1px solid #ddd;padding:12px 0}small{color:#555}.tabs{display:flex;gap:8px;overflow-x:auto}.tabs button{margin:0;white-space:nowrap}.tabs button[aria-current="page"]{background:#fff;color:#111}[data-panel][hidden]{display:none}textarea{min-height:200px;line-height:1.45}#messageIds{overflow-wrap:anywhere}#jobs>div{line-height:1.6}.fp{font-family:ui-monospace,monospace;font-size:12px;background:#f6f6f6;padding:8px 10px;border-radius:6px;margin-top:10px;overflow-wrap:anywhere}select[multiple]{min-height:130px}.warn{background:#fff7e6;border:1px solid #f0c060;padding:10px 14px;border-radius:8px;margin:10px 0;font-size:13px;line-height:1.5}.warn strong{color:#a00}.stat{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#555;margin-top:6px}.stat span{background:#f1f1f1;padding:3px 8px;border-radius:6px}.badge-ok{background:#e6f4ea;color:#0a0}.badge-bad{background:#fce8e8;color:#a00}
</style></head><body><main><h1>Discord</h1><p class="muted">v7 — full proxy pool, delay 20ms floor. Giao diện: Phan Anh Khôi.</p><section id="login" class="card"><h2>Đăng nhập quản trị</h2><form id="loginForm"><label for="password">Mật khẩu quản trị</label><input id="password" type="password" required autocomplete="current-password"><button>Đăng nhập</button></form></section><section id="dashboard" hidden><nav class="tabs"><button type="button" data-tab="compose">Soạn tin</button><button type="button" data-tab="accounts">Tài khoản</button><button type="button" data-tab="tasks">Tác vụ</button><button type="button" data-tab="proxies">Proxy</button></nav>
<div class="card" data-panel="accounts"><h2>Token tài khoản (user)</h2><p class="muted" id="tokenStatus">Chưa nhập token</p><div class="warn"><strong>Warm-up ${WARMUP_TOTAL_MS/1000}s</strong> · delay floor 20ms · pacing ${PACING_MIN_MS}–${PACING_MAX_MS}ms · conc ${ACCOUNT_CONCURRENCY}/acc</div><form id="tokenForm"><label for="accountToken">Nhập token user</label><input id="accountToken" type="password" autocomplete="off" required><button>Thêm + warm-up (${WARMUP_TOTAL_MS/1000}s)</button></form><button id="clearToken" class="secondary" type="button">Xóa hết token</button><div id="fpList"></div></div>
<div class="card" data-panel="compose"><h2>Full coverage — mỗi acc chạy full list kênh</h2><form id="sendForm"><label for="accountSelect">Tài khoản gửi (Ctrl/Cmd+click chọn nhiều)</label><select id="accountSelect" multiple required></select><button type="button" id="loadChats" class="secondary">Tải tên chat (acc đầu tiên)</button><label for="chatSelect">Chọn chat theo tên</label><select id="chatSelect" multiple size="5"><option value="">Chọn chat hoặc nhập ID bên dưới</option></select><button type="button" id="loadIds" class="secondary">Tải ID tin nhắn</button><p id="messageIds" class="muted"></p><label for="channel">ID chat (tối đa 200, cách nhau dấu phẩy)</label><input id="channel" inputmode="numeric" required><label for="message">Nội dung (mỗi dòng = 1 biến thể, xoay vòng)</label><textarea id="message" maxlength="12000" required placeholder="Dòng 1&#10;Dòng 2&#10;Dòng 3&#10;..."></textarea><label for="mentions">ID người được nhắc (tùy chọn, tối đa 5)</label><input id="mentions" placeholder="123456789012345678"><label style="font-weight:400"><input id="everyone" type="checkbox" style="width:auto"> Nhắc @everyone (1 acc × 1 kênh × 1 dòng)</label><p class="muted" id="preview">—</p><button class="danger">Bắt đầu full coverage</button></form><p class="muted">Mỗi tin đi 1 proxy random trong pool healthy. Connection fail → retry qua proxy khác.</p></div>
<div class="card" data-panel="tasks"><h2>Tác vụ</h2><button id="stopAll" class="danger" type="button" style="margin-bottom:14px">Dừng tất cả</button><div id="jobs"></div><button id="logout" type="button" class="secondary">Đăng xuất</button></div>
<div class="card" data-panel="proxies"><h2>Proxy pool</h2><p class="muted" id="proxySummary">Đang tải...</p><button id="recheckProxies" class="secondary" type="button">Re-check toàn bộ</button><div id="proxyList"></div></div>
</section><p id="error" role="alert"></p></main><script>
const $=id=>document.getElementById(id);const err=s=>$('error').textContent=s||'';
function showTab(name){for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==name;for(const b of document.querySelectorAll('[data-tab]')){if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
showTab('compose');
async function api(path,body,method='POST'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Yêu cầu thất bại');return j}
function selectedAccounts(){return Array.from($('accountSelect').selectedOptions).map(o=>o.value).filter(Boolean)}
function updatePreview(){const accs=selectedAccounts().length;const chs=$('channel').value.split(',').map(x=>x.trim()).filter(Boolean).length;$('preview').textContent='Full coverage: '+accs+' acc × '+chs+' kênh = '+(accs*chs)+' tin/chu kỳ. Pacing ${PACING_MIN_MS}–${PACING_MAX_MS}ms, conc ${ACCOUNT_CONCURRENCY}/acc.'}
$('accountSelect').onchange=updatePreview;$('channel').oninput=updatePreview;
async function refresh(){try{const j=await api('/api/jobs',null,'GET');$('login').hidden=true;$('dashboard').hidden=false;$('jobs').replaceChildren();for(const item of j.jobs){const div=document.createElement('div');const t=document.createElement('strong');t.textContent=(item.accountName||item.account)+' · '+item.status+' · đã gửi '+item.sent+' · '+item.channelCount+' kênh';div.append(t);const s=document.createElement('div');s.className='stat';s.innerHTML='<span>idx '+item.channelIdx+'/'+item.channelCount+'</span><span>conc '+item.concurrency+'</span><span>last '+(item.lastChannel||'-')+'</span>';div.append(s);if(item.lastError){const d=document.createElement('div');d.style.color='#a00';d.textContent=item.lastError;div.append(d)}if(item.status==='running'||item.status==='warming'){const b=document.createElement('button');b.className='secondary';b.textContent='Dừng';b.onclick=async()=>{try{await api('/api/jobs/'+item.id+'/stop');refresh()}catch(e){err(e.message)}};div.append(b)}$('jobs').append(div)}if(!j.jobs.length)$('jobs').textContent='Chưa có tác vụ.'}catch(e){$('login').hidden=false;$('dashboard').hidden=true}}
async function refreshProxies(){try{const d=await api('/api/proxies',null,'GET');$('proxySummary').textContent=d.total+' proxy · '+d.healthy+' healthy · '+d.cooldown+' cooldown · '+d.dead+' dead';$('proxyList').replaceChildren();for(const p of d.proxies){const row=document.createElement('div');row.className='fp';const badge=p.healthy?'✓':'✗';const cls=p.healthy?'badge-ok':'badge-bad';row.innerHTML='<span class="'+cls+'" style="padding:2px 6px;border-radius:4px;margin-right:8px">'+badge+'</span>'+p.url+(p.failCount?' · fail '+p.failCount:'')}if(d.proxies.length===0)$('proxyList').textContent='Không có proxy.'}}catch{}}
$('recheckProxies').onclick=async()=>{try{$('recheckProxies').disabled=true;await api('/api/proxies/recheck');await refreshProxies()}catch(x){err(x.message)}finally{$('recheckProxies').disabled=false}};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{password:$('password').value});$('password').value='';err('');await refresh();await accountsInfo()}catch(x){err(x.message)}};
$('tokenForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter||e.target.querySelector('button');try{btn.disabled=true;btn.textContent='Warm-up...';await api('/api/token',{token:$('accountToken').value});$('accountToken').value='';err('');await accountsInfo()}catch(x){err(x.message)}finally{btn.disabled=false;btn.textContent='Thêm + warm-up (${WARMUP_TOTAL_MS/1000}s)'}};
$('clearToken').onclick=async()=>{try{await api('/api/token',null,'DELETE');await accountsInfo();err('')}catch(x){err(x.message)}};
$('loadChats').onclick=async()=>{try{err('');$('loadChats').disabled=true;const id=selectedAccounts()[0];if(!id)throw Error('Chọn ít nhất 1 tài khoản.');const data=await api('/api/chats?account='+encodeURIComponent(id),null,'GET');const select=$('chatSelect');select.replaceChildren(new Option('Chọn chat hoặc nhập ID bên dưới',''));for(const c of data.channels)select.add(new Option(c.name+' ('+c.id+')',c.id));if(data.inaccessible)err('Một số chat không tải được.');}catch(x){err(x.message)}finally{$('loadChats').disabled=false}};
$('chatSelect').onchange=()=>{$('channel').value=Array.from($('chatSelect').selectedOptions).map(o=>o.value).filter(Boolean).join(', ');updatePreview()};
$('loadIds').onclick=async()=>{try{err('');$('loadIds').disabled=true;const id=selectedAccounts()[0],channel=$('channel').value.split(',')[0].trim();if(!id||!channel)throw Error('Chọn tài khoản và chat.');const data=await api('/api/message-ids?account='+encodeURIComponent(id)+'&channel='+encodeURIComponent(channel),null,'GET');$('messageIds').textContent=data.ids.length+' ID: '+data.ids.join(', ')}catch(x){err(x.message)}finally{$('loadIds').disabled=false}};
$('sendForm').onsubmit=async e=>{e.preventDefault();try{const accounts=selectedAccounts();if(!accounts.length)throw Error('Chọn ít nhất 1 tài khoản.');const r=await api('/api/jobs',{accounts,channel:$('channel').value,content:$('message').value,mentions:$('mentions').value,everyone:$('everyone').checked});err('Đã tạo '+r.jobs.length+' job.');refresh()}catch(x){err(x.message)}};
$('stopAll').onclick=async()=>{try{await api('/api/jobs/stop-all');refresh()}catch(x){err(x.message)}};
async function accountsInfo(){try{const data=await api('/api/token',null,'GET');const select=$('accountSelect');const current=new Set(selectedAccounts());select.replaceChildren();for(const a of data.accounts){const o=new Option(a.name+' ('+a.id+')',a.id);o.selected=current.has(a.id);select.add(o)}if(!data.accounts.length)select.add(new Option('(chưa có acc)',''));$('tokenStatus').textContent=data.accounts.length+' tài khoản';$('fpList').replaceChildren();for(const a of data.accounts){const d=document.createElement('div');d.className='fp';d.textContent='['+a.name+'] '+a.fingerprint}updatePreview()}catch{}}
$('logout').onclick=async()=>{await api('/api/logout');refresh()};
refresh();refreshProxies();setInterval(()=>{if(!$('dashboard').hidden){refresh();accountsInfo()}},4000);setInterval(refreshProxies,10000);
</script></body></html>`;

// ---------------- helpers ----------------
function json(res, status, data, cookie) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(cookie ? { 'Set-Cookie': cookie } : {}),
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) { reject(Error('Dữ liệu quá lớn')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}
function currentSession(req) {
  const id = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return id && sessions.get(id)?.expires > Date.now() ? id : null;
}

const sessions = new Map();
const jobs = new Map();
const loginAttempts = new Map();
const MAX_BODY = 128 * 1024;
const SESSION_TTL = 8 * 3600 * 1000;

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/health') return json(res, 200, { status: 'ok' });
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(html);
  }

  if (path === '/api/login' && req.method === 'POST') {
    try {
      const ip = req.socket.remoteAddress || 'unknown';
      const state = loginAttempts.get(ip) || { count: 0, until: 0 };
      if (state.until > Date.now()) return json(res, 429, { error: 'Thử lại sau 15 phút' });
      const body = await readBody(req);
      const submitted = String(body.password || '');
      const candidate = scryptSync(submitted.slice(0, 1024), PASSWORD_SALT, 64);
      if (!timingSafeEqual(candidate, PASSWORD_HASH)) {
        state.count++;
        if (state.count >= 5) { state.until = Date.now() + 15 * 60000; state.count = 0; }
        loginAttempts.set(ip, state);
        return json(res, 401, { error: 'Mật khẩu không đúng' });
      }
      loginAttempts.delete(ip);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { expires: Date.now() + SESSION_TTL, accounts: [] });
      return json(res, 200, { ok: true },
        `session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  const session = currentSession(req);
  if (!session) return json(res, 401, { error: 'Cần đăng nhập' });
  const sess = sessions.get(session);

  if (path === '/api/proxies' && req.method === 'GET') {
    const now = Date.now();
    let healthy = 0, cooldown = 0, dead = 0;
    const list = [...proxyState.entries()].map(([url, st]) => {
      const isCooldown = st.cooldownUntil > now;
      const isHealthy = st.healthy === true && !isCooldown;
      if (isHealthy) healthy++;
      else if (isCooldown) cooldown++;
      else dead++;
      return {
        url, healthy: isHealthy,
        cooldown: isCooldown ? Math.ceil((st.cooldownUntil - now) / 1000) : 0,
        failCount: st.failCount,
      };
    });
    return json(res, 200, { total: list.length, healthy, cooldown, dead, proxies: list });
  }

  if (path === '/api/proxies/recheck' && req.method === 'POST') {
    healthCheckAll().catch(() => {});
    return json(res, 200, { ok: true });
  }

  if (path === '/api/logout' && req.method === 'POST') {
    for (const job of jobs.values()) if (job.session === session) stopJob(job);
    sessions.delete(session);
    return json(res, 200, { ok: true },
      'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  }

  if (path === '/api/token' && req.method === 'GET') {
    return json(res, 200, {
      accounts: sess.accounts.map(a => ({
        id: a.id, name: a.name,
        fingerprint: `${a.fingerprint.os} · Chrome ${a.fingerprint.browserVersion} · ${a.fingerprint.locale}`,
      })),
    });
  }

  if (path === '/api/token' && req.method === 'DELETE') {
    for (const job of jobs.values()) if (job.session === session) stopJob(job);
    sess.accounts = [];
    return json(res, 200, { accounts: [] });
  }

  if (path === '/api/token' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      const token = String(b.token || '').trim();
      if (token.length < 20 || token.length > 512 || /[\s\r\n]/.test(token)) {
        return json(res, 400, { error: 'Token không hợp lệ' });
      }
      const seed = Buffer.alloc(4);
      Buffer.from(token).copy(seed, 0, 0, Math.min(4, token.length));
      const fp = makeFingerprint(seed);
      const account = { id: null, name: null, token, fingerprint: fp, warmupUntil: 0 };
      const me = await warmLogin(account);
      if (!me || !me.id) return json(res, 400, { error: 'Token không hợp lệ' });
      account.id = String(me.id);
      account.name = String(me.global_name || me.username || me.id);
      const list = sess.accounts;
      const existing = list.findIndex(a => a.id === account.id);
      if (existing >= 0) list[existing] = account;
      else if (list.length < 30) list.push(account);
      else return json(res, 400, { error: 'Tối đa 30 tài khoản' });
      return json(res, 200, {
        user: { id: account.id, name: account.name },
        fingerprint: `${fp.os} · Chrome ${fp.browserVersion} · ${fp.locale}`,
      });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (path === '/api/chats' && req.method === 'GET') {
    try {
      const selected = new URL(req.url, 'http://localhost').searchParams.get('account');
      const account = sess.accounts.find(a => a.id === selected);
      if (!account) return json(res, 400, { error: 'Chọn tài khoản đã nhập' });

      const guilds = await discordFetch('/users/@me/guilds?limit=200', account);
      const channels = [];
      let inaccessible = 0;
      for (let i = 0; i < guilds.length; i += 5) {
        const slice = guilds.slice(i, i + 5);
        const results = await Promise.allSettled(slice.map(g =>
          discordFetch(`/guilds/${g.id}/channels`, account)));
        results.forEach((r, j) => {
          if (r.status === 'rejected') { inaccessible++; return; }
          for (const ch of r.value) {
            if ((ch.type === 0 || ch.type === 5) && ch.id && ch.name) {
              channels.push({ id: ch.id, name: `${slice[j].name} / ${ch.name}` });
            }
          }
        });
      }
      try {
        const dms = await discordFetch('/users/@me/channels', account);
        for (const ch of dms) {
          const names = (ch.recipients || []).map(x => x.global_name || x.username).filter(Boolean);
          channels.push({ id: ch.id, name: ch.name || names.join(', ') || `Chat ${ch.id}` });
        }
      } catch { inaccessible++; }
      channels.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return json(res, 200, { channels, inaccessible });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  if (path === '/api/message-ids' && req.method === 'GET') {
    try {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const account = sess.accounts.find(a => a.id === q.get('account'));
      const channel = q.get('channel');
      if (!account || !/^\d{17,22}$/.test(channel || '')) {
        return json(res, 400, { error: 'Chọn tài khoản và chat hợp lệ' });
      }
      const ids = []; let before = ''; let more = true;
      for (let page = 0; page < 5; page++) {
        const qs = `/channels/${channel}/messages?limit=100${before ? '&before=' + before : ''}`;
        const messages = await discordFetch(qs, account);
        if (!Array.isArray(messages)) throw Error('Discord trả dữ liệu không hợp lệ');
        ids.push(...messages.map(m => m.id));
        if (messages.length < 100) { more = false; break; }
        before = messages[messages.length - 1].id;
      }
      return json(res, 200, { ids, more });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  if (path === '/api/jobs' && req.method === 'GET') {
    const mine = [...jobs.values()].filter(j => j.session === session).map(publicJob);
    return json(res, 200, { jobs: mine });
  }

  if (path === '/api/jobs' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      const accounts = [...new Set((Array.isArray(b.accounts) ? b.accounts : []).map(String))];
      const channels = [...new Set(String(b.channel || '').split(',').map(x => x.trim()).filter(Boolean))];
      const lines = cleanMessage(b.content);
      const mentions = String(b.mentions || '').split(',').map(x => x.trim()).filter(Boolean);
      const everyone = b.everyone === true;

      if (!accounts.length || accounts.length > 30) return json(res, 400, { error: 'Chọn 1–30 tài khoản' });
      if (!channels.length || channels.length > 200 || channels.some(x => !/^\d{17,22}$/.test(x)))
        return json(res, 400, { error: 'ID chat không hợp lệ (1–200)' });
      if (!lines.length || lines.length > 10) return json(res, 400, { error: 'Nội dung 1–10 đoạn' });
      if (mentions.length > 5 || mentions.some(x => !/^\d{17,22}$/.test(x)))
        return json(res, 400, { error: 'Mention không hợp lệ' });
      if (everyone && (accounts.length !== 1 || channels.length !== 1 || lines.length !== 1))
        return json(res, 400, { error: '@everyone: đúng 1 acc × 1 kênh × 1 dòng' });

      for (const id of accounts) {
        if (!sess.accounts.find(a => a.id === id))
          return json(res, 400, { error: `Tài khoản ${id} không thuộc phiên` });
      }

      const created = [];
      accounts.forEach((accountId, i) => {
        const acc = sess.accounts.find(a => a.id === accountId);
        const startIndex = Math.floor((i * channels.length) / accounts.length);
        created.push({
          id: randomBytes(8).toString('hex'),
          session, account: accountId, accountName: acc.name,
          channels: channels.slice(), channelIdx: startIndex, startIndex,
          concurrency: everyone ? 1 : ACCOUNT_CONCURRENCY,
          lastChannel: null, lines, mentions, everyone,
          continuous: !everyone,
          sent: 0, status: 'running', lastError: '',
          startedAt: Date.now(), endedAt: null,
        });
      });

      for (const job of created) jobs.set(job.id, job);
      void runBatch(created);

      return json(res, 201, {
        jobs: created.map(publicJob),
        totalAccounts: accounts.length,
        totalChannels: channels.length,
        concurrency: ACCOUNT_CONCURRENCY,
      });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (path === '/api/jobs/stop-all' && req.method === 'POST') {
    let n = 0;
    for (const job of jobs.values()) if (job.session === session) { stopJob(job); n++; }
    return json(res, 200, { stopped: n });
  }

  const stop = path.match(/^\/api\/jobs\/([a-f0-9]{16})\/stop$/);
  if (stop && req.method === 'POST') {
    const job = jobs.get(stop[1]);
    if (!job || job.session !== session) return json(res, 404, { error: 'Không tìm thấy' });
    stopJob(job);
    return json(res, 200, { job: publicJob(job) });
  }

  return json(res, 404, { error: 'Không tìm thấy' });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && job.status !== 'warming'
      && job.endedAt && now - job.endedAt > 5 * 60000) {
      jobs.delete(id);
    }
  }
}, 60000).unref();

// re-check dead proxies every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [url, st] of proxyState) {
    if (st.healthy === false || st.cooldownUntil > 0) {
      healthCheck(url).catch(() => {});
    }
  }
}, 5 * 60000).unref();

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Listening on ${PORT}`);
  console.log(`ADMIN_PASSWORD=${ADMIN_PASSWORD}`);
  console.log(`v7 · pacing ${PACING_MIN_MS}–${PACING_MAX_MS}ms · conc ${ACCOUNT_CONCURRENCY}/acc · warmup ${WARMUP_TOTAL_MS}ms · proxies ${PROXY_LIST.length}`);
  await healthCheckAll();
});
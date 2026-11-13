const http = require('node:http');
const {randomBytes, timingSafeEqual, scryptSync} = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ACCOUNT_TOKEN = process.env.DISCORD_ACCOUNT_TOKEN || '';
const PASSWORD_SALT = process.env.PASSWORD_SALT || '';
const sessions = new Map();
const jobs = new Map();
const loginAttempts = new Map();
const MAX_BODY = 16 * 1024;

if (!ADMIN_PASSWORD || !ACCOUNT_TOKEN || !PASSWORD_SALT || ADMIN_PASSWORD.length < 16 || PASSWORD_SALT.length < 16) {
  console.error('Set ADMIN_PASSWORD (16+ chars), PASSWORD_SALT (16+ chars), and DISCORD_ACCOUNT_TOKEN in Render environment.');
  process.exit(1);
}
const passwordDigest=scryptSync(ADMIN_PASSWORD,PASSWORD_SALT,64);

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Discord | Phan Anh Khôi</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fff}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:50px auto;padding:0 20px}h1{font-size:32px;letter-spacing:-.04em}h2{font-size:19px;margin-top:0}.muted{color:#555;line-height:1.5}.card{border:1px solid #ddd;border-radius:14px;padding:24px;margin:18px 0}.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1}label{display:block;font-size:14px;font-weight:600;margin:14px 0 5px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:11px;border:1px solid #aaa;border-radius:8px;color:#111;background:#fff}textarea{min-height:96px;resize:vertical}button{background:#111;color:#fff;border:1px solid #111;border-radius:8px;padding:10px 15px;cursor:pointer;margin-top:14px}button.secondary{background:#fff;color:#111}button:disabled{opacity:.5;cursor:default}#error{white-space:pre-wrap;color:#a00}#jobs>div{border-top:1px solid #ddd;padding:12px 0}small{color:#555}</style></head><body><main><h1>Discord</h1><p class="muted">Bảng điều khiển tài khoản Discord. Tác giả giao diện: Phan Anh Khôi.</p><section id="login" class="card"><h2>Đăng nhập quản trị</h2><form id="loginForm"><label for="password">Mật khẩu quản trị</label><input id="password" type="password" required autocomplete="current-password"><button>Đăng nhập</button></form></section><section id="dashboard" hidden><div class="card"><h2>Gửi tin nhắn</h2><form id="sendForm"><label for="channel">Channel ID</label><input id="channel" inputmode="numeric" pattern="[0-9]{17,22}" required><label for="message">Nội dung (mỗi dòng là một tin nhắn theo lượt)</label><textarea id="message" maxlength="4000" required></textarea><label for="mentions">ID người được nhắc đến (tùy chọn, cách nhau bằng dấu phẩy; tối đa 5)</label><input id="mentions" placeholder="123456789012345678"><div class="row"><div><label for="count">Số lượt (1–20)</label><input id="count" type="number" value="1" min="1" max="20" required></div><div><label for="delay">Khoảng cách (giây, tối thiểu 15)</label><input id="delay" type="number" value="15" min="15" max="3600" required></div></div><button>Bắt đầu</button></form><p class="muted">Tác vụ nằm trong bộ nhớ máy chủ; Render khởi động lại sẽ dừng tác vụ.</p></div><div class="card"><h2>Tác vụ</h2><div id="jobs"></div><button id="logout" type="button" class="secondary">Đăng xuất</button></div></section><p id="error" role="alert"></p></main><script>
const $=id=>document.getElementById(id);const err=s=>$('error').textContent=s||'';
async function api(path,body,method='POST'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Yêu cầu thất bại');return j}
async function refresh(){try{const j=await api('/api/jobs',null,'GET');$('login').hidden=true;$('dashboard').hidden=false;$('jobs').replaceChildren();for(const item of j.jobs){const div=document.createElement('div');const title=document.createElement('strong');title.textContent='Kênh '+item.channel+' · '+item.status+' · '+item.sent+'/'+item.count;div.append(title);const detail=document.createElement('div');detail.textContent=item.lastError||'';div.append(detail);if(item.status==='running'){const stop=document.createElement('button');stop.className='secondary';stop.textContent='Dừng';stop.onclick=async()=>{try{await api('/api/jobs/'+item.id+'/stop');refresh()}catch(e){err(e.message)}};div.append(stop)}$('jobs').append(div)}if(!j.jobs.length)$('jobs').textContent='Chưa có tác vụ.'}catch(e){$('login').hidden=false;$('dashboard').hidden=true}}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{password:$('password').value});$('password').value='';err('');refresh()}catch(x){err(x.message)}};
$('sendForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/jobs',{channel:$('channel').value,content:$('message').value,mentions:$('mentions').value,count:Number($('count').value),delay:Number($('delay').value)});err('');refresh()}catch(x){err(x.message)}};
$('logout').onclick=async()=>{await api('/api/logout');refresh()};refresh();setInterval(()=>{if(!$('dashboard').hidden)refresh()},5000);
</script></body></html>`;

function json(res, status, data, cookie) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));
}
function safeEqual(a,b) {const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length && timingSafeEqual(x,y)}
function readBody(req) {return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>MAX_BODY){reject(Error('Dữ liệu quá lớn'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(Error('JSON không hợp lệ'))}});req.on('error',reject)})}
function currentSession(req){const id=(req.headers.cookie||'').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];return id && sessions.get(id)>Date.now() ? id:null}
function cleanMessage(s){return String(s||'').split('\n').map(x=>x.trim()).filter(Boolean)}
async function sendMessage(job, message){
  const url=`https://discord.com/api/v10/channels/${job.channel}/messages`;
  const content=message+(job.mentions.length?' '+job.mentions.map(x=>`<@${x}>`).join(' '):'');
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(url,{method:'POST',headers:{Authorization:ACCOUNT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:[],users:job.mentions}}),signal:AbortSignal.timeout(15000)});
    if(response.status===429){const data=await response.json();const wait=Math.min(60000,Math.max(1000,Number(data.retry_after||1)*1000));await new Promise(r=>setTimeout(r,wait));if(job.status!=='running')return;continue}
    if(!response.ok)throw Error(`Discord HTTP ${response.status}: ${String(await response.text()).slice(0,180)}`);
    return;
  }
  throw Error('Discord giới hạn tốc độ; hãy thử lại sau.');
}
async function run(job){
  for(let i=0;i<job.count && job.status==='running';i++){
    try{await sendMessage(job,job.lines[i%job.lines.length]);if(job.status==='running')job.sent++}
    catch(e){job.lastError=e.message;job.status='failed';break}
    if(i+1<job.count && job.status==='running')await new Promise(r=>{job.timer=setTimeout(r,job.delay*1000);job.wake=r});
  }
  if(job.status==='running')job.status='completed';job.timer=null;job.wake=null;
}
function publicJob(j){return {id:j.id,channel:j.channel,status:j.status,sent:j.sent,count:j.count,lastError:j.lastError}}
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET' && path==='/health')return json(res,200,{status:'ok'});
  if(req.method==='GET' && path==='/'){if(!currentSession(req)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(html)}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(html)}
  if(path==='/api/login' && req.method==='POST'){
    try{const ip=req.socket.remoteAddress||'unknown';const state=loginAttempts.get(ip)||{count:0,until:0};if(state.until>Date.now())return json(res,429,{error:'Thử lại sau 15 phút'});const body=await readBody(req);const submitted=String(body.password||'');const candidate=scryptSync(submitted.slice(0,1024),PASSWORD_SALT,64);if(!timingSafeEqual(candidate,passwordDigest)){state.count++;if(state.count>=5){state.until=Date.now()+15*60000;state.count=0}loginAttempts.set(ip,state);return json(res,401,{error:'Mật khẩu không đúng'})}loginAttempts.delete(ip);const id=randomBytes(32).toString('hex');sessions.set(id,Date.now()+8*3600000);return json(res,200,{ok:true},`session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`)}catch(e){return json(res,400,{error:e.message})}
  }
  const session=currentSession(req);if(!session)return json(res,401,{error:'Cần đăng nhập'});
  if(path==='/api/logout' && req.method==='POST'){sessions.delete(session);return json(res,200,{ok:true},'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')}
  if(path==='/api/jobs' && req.method==='GET')return json(res,200,{jobs:[...jobs.values()].map(publicJob)});
  if(path==='/api/jobs' && req.method==='POST'){
    try{
      const b=await readBody(req);const channel=String(b.channel||'');const lines=cleanMessage(b.content);const mentions=String(b.mentions||'').split(',').map(x=>x.trim()).filter(Boolean);const count=b.count,delay=b.delay;
      if(!/^\d{17,22}$/.test(channel)||!lines.length||lines.length>30||lines.some(x=>x.length>1900)||mentions.length>5||mentions.some(x=>!/^\d{17,22}$/.test(x))||!Number.isInteger(count)||count<1||count>20||!Number.isInteger(delay)||delay<15||delay>3600) return json(res,400,{error:'Kiểm tra Channel ID, nội dung, ID nhắc đến, số lượt và khoảng cách.'});
      if([...jobs.values()].some(j=>j.status==='running'))return json(res,409,{error:'Chỉ chạy một tác vụ tại một thời điểm.'});
      const job={id:randomBytes(8).toString('hex'),channel,lines,mentions,count,delay,sent:0,status:'running',lastError:'',timer:null,wake:null};jobs.set(job.id,job);void run(job);return json(res,201,{job:publicJob(job)});
    }catch(e){return json(res,400,{error:e.message})}
  }
  const match=path.match(/^\/api\/jobs\/([a-f0-9]{16})\/stop$/);
  if(match&&req.method==='POST'){const job=jobs.get(match[1]);if(!job)return json(res,404,{error:'Không tìm thấy tác vụ'});job.status='stopped';if(job.timer){clearTimeout(job.timer);job.wake?.()}return json(res,200,{job:publicJob(job)})}
  return json(res,404,{error:'Không tìm thấy trang'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Listening on ${PORT}`));

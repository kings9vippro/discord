const http = require('node:http');
const {randomBytes, timingSafeEqual, scryptSync} = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const PASSWORD_SALT = 'fZd26jJvW13v2yRhO89KijsVDMiA_beM';
const PASSWORD_HASH = Buffer.from('04d20917ba6a6da1ba7deb6c425eb412f85f0be1e80cbf4616d44cf0cb9d4b739ad49e0dd94489af462283e1cb9b826573193a7d6ef903901efd95295b4f291f','hex');
const sessions = new Map();
const jobs = new Map();
const loginAttempts = new Map();
const MAX_BODY = 64 * 1024;

// Only a scrypt verifier is committed. The generated password is delivered to the owner.

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Discord | Phan Anh Khôi</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fff}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:50px auto;padding:0 20px}h1{font-size:32px;letter-spacing:-.04em}h2{font-size:19px;margin-top:0}.muted{color:#555;line-height:1.5}.card{border:1px solid #ddd;border-radius:14px;padding:24px;margin:18px 0}.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1}label{display:block;font-size:14px;font-weight:600;margin:14px 0 5px}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;padding:11px;border:1px solid #aaa;border-radius:8px;color:#111;background:#fff}textarea{min-height:96px;resize:vertical}button{background:#111;color:#fff;border:1px solid #111;border-radius:8px;padding:10px 15px;cursor:pointer;margin-top:14px}button.secondary{background:#fff;color:#111}button:disabled{opacity:.5;cursor:default}#error{white-space:pre-wrap;color:#a00}#jobs>div{border-top:1px solid #ddd;padding:12px 0}small{color:#555}.tabs{display:flex;gap:8px;overflow-x:auto}.tabs button{margin:0;white-space:nowrap}.tabs button[aria-current="page"]{background:#fff;color:#111}[data-panel][hidden]{display:none}textarea{min-height:200px;line-height:1.45}#messageIds{overflow-wrap:anywhere}#jobs>div{line-height:1.6}</style></head><body><main><h1>Discord</h1><p class="muted">Bảng điều khiển tài khoản Discord. Tác giả giao diện: Phan Anh Khôi.</p><section id="login" class="card"><h2>Đăng nhập quản trị</h2><form id="loginForm"><label for="password">Mật khẩu quản trị</label><input id="password" type="password" required autocomplete="current-password"><button>Đăng nhập</button></form></section><section id="dashboard" hidden><nav class="tabs"><button type="button" data-tab="compose">Soạn tin</button><button type="button" data-tab="accounts">Tài khoản</button><button type="button" data-tab="tasks">Tác vụ</button></nav><div class="card" data-panel="accounts"><h2>Token tài khoản</h2><p class="muted" id="tokenStatus">Chưa nhập token</p><form id="tokenForm"><label for="accountToken">Nhập token trong phiên này</label><input id="accountToken" type="password" autocomplete="off" required><button>Lưu trong phiên</button></form><button id="clearToken" class="secondary" type="button">Xóa token</button></div><div class="card" data-panel="compose"><h2>Gửi tin nhắn</h2><form id="sendForm"><label for="accountSelect">Tài khoản gửi</label><select id="accountSelect"><option value="">Chọn tài khoản</option></select><button type="button" id="loadChats" class="secondary">Tải tên chat</button><label for="chatSelect">Chọn chat theo tên</label><select id="chatSelect"><option value="">Chọn chat hoặc nhập ID bên dưới</option></select><button type="button" id="loadIds" class="secondary">Tải ID tin nhắn</button><p id="messageIds" class="muted"></p><label for="channel">Channel ID</label><input id="channel" inputmode="numeric" pattern="[0-9]{17,22}" required><label for="message">Nội dung (giữ nguyên xuống dòng trong một tin)</label><textarea id="message" maxlength="12000" required></textarea><label for="mentions">ID người được nhắc đến (tùy chọn, cách nhau bằng dấu phẩy; tối đa 5)</label><input id="mentions" placeholder="123456789012345678"><label style="font-weight:400"><input id="everyone" type="checkbox" style="width:auto"> Nhắc @everyone (chỉ một tin một lần, cần quyền trong chat)</label><div class="row"><div><label for="count">Số lượt lặp (1–20)</label><input id="count" type="number" value="1" min="1" max="20" required></div><div><label for="delay">Khoảng cách giữa lần gửi (giây)</label><input id="delay" type="number" value="1" min="1" max="3600" required></div></div><button>Bắt đầu</button></form><p class="muted">Tác vụ nằm trong bộ nhớ máy chủ; Render khởi động lại sẽ dừng tác vụ.</p></div><div class="card" data-panel="tasks"><h2>Tác vụ</h2><div id="jobs"></div><button id="logout" type="button" class="secondary">Đăng xuất</button></div></section><p id="error" role="alert"></p></main><script>
const $=id=>document.getElementById(id);const err=s=>$('error').textContent=s||'';
function showTab(name){for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==name;for(const button of document.querySelectorAll('[data-tab]')){if(button.dataset.tab===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')}}
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>showTab(button.dataset.tab);
showTab('compose');
async function api(path,body,method='POST'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Yêu cầu thất bại');return j}
async function refresh(){try{const j=await api('/api/jobs',null,'GET');$('login').hidden=true;$('dashboard').hidden=false;$('jobs').replaceChildren();for(const item of j.jobs){const div=document.createElement('div');const title=document.createElement('strong');title.textContent='Kênh '+item.channel+' · '+item.status+' · '+item.sent+'/'+item.total;div.append(title);const detail=document.createElement('div');detail.textContent=item.lastError||'';div.append(detail);if(item.status==='running'){const stop=document.createElement('button');stop.className='secondary';stop.textContent='Dừng';stop.onclick=async()=>{try{await api('/api/jobs/'+item.id+'/stop');refresh()}catch(e){err(e.message)}};div.append(stop)}$('jobs').append(div)}if(!j.jobs.length)$('jobs').textContent='Chưa có tác vụ.'}catch(e){$('login').hidden=false;$('dashboard').hidden=true}}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{password:$('password').value});$('password').value='';err('');await refresh();await accountsInfo()}catch(x){err(x.message)}};
$('tokenForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/token',{token:$('accountToken').value});$('accountToken').value='';err('');await accountsInfo()}catch(x){err(x.message)}};
$('clearToken').onclick=async()=>{try{await api('/api/token',null,'DELETE');await accountsInfo();err('')}catch(x){err(x.message)}};
$('loadChats').onclick=async()=>{try{err('');$('loadChats').disabled=true;const id=$('accountSelect').value;if(!id)throw Error('Hãy chọn tài khoản trước.');const data=await api('/api/chats?account='+encodeURIComponent(id),null,'GET');const select=$('chatSelect');select.replaceChildren(new Option('Chọn chat hoặc nhập ID bên dưới',''));for(const c of data.channels)select.add(new Option(c.name+' ('+c.id+')',c.id));if(data.inaccessible)err('Một số chat không thể tải do quyền truy cập hoặc Discord từ chối API.');}catch(x){err(x.message)}finally{$('loadChats').disabled=false}};
$('chatSelect').onchange=()=>{if($('chatSelect').value)$('channel').value=$('chatSelect').value};
$('loadIds').onclick=async()=>{try{err('');$('loadIds').disabled=true;const id=$('accountSelect').value,channel=$('channel').value;if(!id||!channel)throw Error('Hãy chọn tài khoản và chat.');const data=await api('/api/message-ids?account='+encodeURIComponent(id)+'&channel='+encodeURIComponent(channel),null,'GET');$('messageIds').textContent=data.ids.length+' ID tin nhắn gần nhất'+(data.more?' (còn tin nhắn cũ hơn)':'')+': '+data.ids.join(', ')}catch(x){err(x.message)}finally{$('loadIds').disabled=false}};
$('sendForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/jobs',{account:$('accountSelect').value,channel:$('channel').value,content:$('message').value,mentions:$('mentions').value,count:Number($('count').value),delay:Number($('delay').value),everyone:$('everyone').checked});err('');refresh()}catch(x){err(x.message)}};
async function accountsInfo(){try{const data=await api('/api/token',null,'GET');const select=$('accountSelect');const current=select.value;select.replaceChildren(new Option('Chọn tài khoản',''));for(const a of data.accounts)select.add(new Option(a.name+' ('+a.id+')',a.id));if(data.accounts.some(a=>a.id===current))select.value=current;else if(data.accounts.length)select.value=data.accounts[0].id;$('tokenStatus').textContent=data.accounts.length+' tài khoản đã nhập trong phiên'}catch{}}
$('logout').onclick=async()=>{await api('/api/logout');refresh()};refresh();setInterval(()=>{if(!$('dashboard').hidden){refresh();accountsInfo()}},5000);
</script></body></html>`;

function json(res, status, data, cookie) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));
}
function safeEqual(a,b) {const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length && timingSafeEqual(x,y)}
function readBody(req) {return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>MAX_BODY){reject(Error('Dữ liệu quá lớn'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(Error('JSON không hợp lệ'))}});req.on('error',reject)})}
function currentSession(req){const id=(req.headers.cookie||'').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];return id && sessions.get(id)?.expires>Date.now() ? id:null}
// Preserve line breaks. Discord limits message content to 2,000 characters.
// Split long drafts at a line break when possible, otherwise at a code point boundary.
function cleanMessage(s){
  const text=String(s||'').replace(/\r\n/g,'\n').trim();
  if(!text)return [];
  const chars=Array.from(text), parts=[];
  while(chars.length){
    let take=Math.min(1800,chars.length);
    if(take<chars.length){const breakAt=chars.slice(0,take).lastIndexOf('\n');if(breakAt>take/2)take=breakAt+1}
    parts.push(chars.splice(0,take).join(''));
  }
  return parts;
}
async function discordGet(path, token){
  const response=await fetch(`https://discord.com/api/v10${path}`,{headers:{Authorization:token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Discord HTTP ${response.status} khi tải danh sách chat`);
  return response.json();
}
async function sendMessage(job, message){
  const url=`https://discord.com/api/v10/channels/${job.channel}/messages`;
  const content=message+(job.mentions.length?' '+job.mentions.map(x=>`<@${x}>`).join(' '):'')+(job.everyone?' @everyone':'');
  for(let attempt=0;attempt<3;attempt++){
    const credential=sessions.get(job.session)?.accounts.find(a=>a.id===job.account)?.token;
    if(!credential)throw Error('Phiên hoặc token đã bị xóa.');
    const response=await fetch(url,{method:'POST',headers:{Authorization:credential,'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:job.everyone?['everyone']:[],users:job.mentions}}),signal:AbortSignal.timeout(15000)});
    if(response.status===429){const data=await response.json();const wait=Math.min(60000,Math.max(1000,Number(data.retry_after||1)*1000));await new Promise(r=>setTimeout(r,wait));if(job.status!=='running')return;continue}
    if(!response.ok)throw Error(`Discord HTTP ${response.status}: ${String(await response.text()).slice(0,180)}`);
    return;
  }
  throw Error('Discord giới hạn tốc độ; hãy thử lại sau.');
}
async function run(job){
  for(let i=0;i<job.total && job.status==='running';i++){
    try{await sendMessage(job,job.lines[i%job.lines.length]);if(job.status==='running')job.sent++}
    catch(e){job.lastError=e.message;job.status='failed';break}
    if(i+1<job.total && job.status==='running')await new Promise(r=>{job.timer=setTimeout(r,job.delay*1000);job.wake=r});
  }
  if(job.status==='running')job.status='completed';job.timer=null;job.wake=null;
}
function publicJob(j){return {id:j.id,account:j.account,channel:j.channel,status:j.status,sent:j.sent,count:j.count,total:j.total,lastError:j.lastError}}
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET' && path==='/health')return json(res,200,{status:'ok'});
  if(req.method==='GET' && path==='/'){if(!currentSession(req)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(html)}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(html)}
  if(path==='/api/login' && req.method==='POST'){
    try{const ip=req.socket.remoteAddress||'unknown';const state=loginAttempts.get(ip)||{count:0,until:0};if(state.until>Date.now())return json(res,429,{error:'Thử lại sau 15 phút'});const body=await readBody(req);const submitted=String(body.password||'');const candidate=scryptSync(submitted.slice(0,1024),PASSWORD_SALT,64);if(!timingSafeEqual(candidate,PASSWORD_HASH)){state.count++;if(state.count>=5){state.until=Date.now()+15*60000;state.count=0}loginAttempts.set(ip,state);return json(res,401,{error:'Mật khẩu không đúng'})}loginAttempts.delete(ip);const id=randomBytes(32).toString('hex');sessions.set(id,{expires:Date.now()+8*3600000,accounts:[]});return json(res,200,{ok:true},`session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`)}catch(e){return json(res,400,{error:e.message})}
  }
  const session=currentSession(req);if(!session)return json(res,401,{error:'Cần đăng nhập'});
  if(path==='/api/logout' && req.method==='POST'){for(const job of jobs.values())if(job.session===session&&job.status==='running'){job.status='stopped';if(job.timer){clearTimeout(job.timer);job.wake?.()}}sessions.delete(session);return json(res,200,{ok:true},'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')}
  if(path==='/api/token' && req.method==='GET')return json(res,200,{accounts:sessions.get(session).accounts.map(({id,name})=>({id,name}))});
  if(path==='/api/token' && req.method==='DELETE'){for(const job of jobs.values())if(job.session===session&&job.status==='running'){job.status='stopped';if(job.timer){clearTimeout(job.timer);job.wake?.()}}sessions.get(session).accounts=[];return json(res,200,{accounts:[]})}
  if(path==='/api/token' && req.method==='POST'){try{const b=await readBody(req);const token=String(b.token||'').trim();if(token.length<20||token.length>512||/[\s\r\n]/.test(token))return json(res,400,{error:'Token không hợp lệ'});const user=await discordGet('/users/@me',token);const accounts=sessions.get(session).accounts;const entry={id:String(user.id),name:String(user.global_name||user.username||user.id),token};const index=accounts.findIndex(a=>a.id===entry.id);if(index>=0)accounts[index]=entry;else if(accounts.length<5)accounts.push(entry);else return json(res,400,{error:'Tối đa 5 tài khoản trong phiên.'});return json(res,200,{user:{id:entry.id,name:entry.name}})}catch(e){return json(res,400,{error:e.message})}}
  if(path==='/api/chats' && req.method==='GET'){
    try{
      const selected=new URL(req.url,'http://localhost').searchParams.get('account');const token=sessions.get(session).accounts.find(a=>a.id===selected)?.token;if(!token)return json(res,400,{error:'Hãy chọn tài khoản đã nhập.'});
      const guilds=await discordGet('/users/@me/guilds?limit=200',token);
      const lists=[];for(let i=0;i<guilds.length;i+=5)lists.push(...await Promise.allSettled(guilds.slice(i,i+5).map(g=>discordGet(`/guilds/${g.id}/channels`,token))));
      const channels=[];let inaccessible=0;
      lists.forEach((item,i)=>{if(item.status==='rejected'){inaccessible++;return}for(const ch of item.value){if((ch.type===0||ch.type===5)&&ch.id&&ch.name)channels.push({id:ch.id,name:`${guilds[i].name} / ${ch.name}`,type:'server'})}});
      try{const dms=await discordGet('/users/@me/channels',token);for(const ch of dms){const names=(ch.recipients||[]).map(x=>x.global_name||x.username).filter(Boolean);channels.push({id:ch.id,name:ch.name||names.join(', ')||`Chat ${ch.id}`,type:'private'})}}catch{inaccessible++}
      channels.sort((a,b)=>a.name.localeCompare(b.name,'vi'));return json(res,200,{channels,inaccessible});
    }catch(e){return json(res,502,{error:e.message})}
  }
  if(path==='/api/message-ids' && req.method==='GET'){
    try{
      const q=new URL(req.url,'http://localhost').searchParams;const token=sessions.get(session).accounts.find(a=>a.id===q.get('account'))?.token;const channel=q.get('channel');if(!token||!/^\d{17,22}$/.test(channel||''))return json(res,400,{error:'Chọn tài khoản và chat hợp lệ.'});
      const ids=[];let before='';let more=true;
      for(let page=0;page<5;page++){
        const messages=await discordGet(`/channels/${channel}/messages?limit=100${before?'&before='+before:''}`,token);
        if(!Array.isArray(messages))throw Error('Discord trả dữ liệu không hợp lệ');
        ids.push(...messages.map(m=>m.id));if(messages.length<100){more=false;break}before=messages[messages.length-1].id;
      }
      return json(res,200,{ids,more});
    }catch(e){return json(res,502,{error:e.message})}
  }
  if(path==='/api/jobs' && req.method==='GET')return json(res,200,{jobs:[...jobs.values()].map(publicJob)});
  if(path==='/api/jobs' && req.method==='POST'){
    try{
      const b=await readBody(req);const channel=String(b.channel||'');const lines=cleanMessage(b.content);const mentions=String(b.mentions||'').split(',').map(x=>x.trim()).filter(Boolean);const count=b.count,delay=b.delay,everyone=b.everyone===true;
      if(!/^\d{17,22}$/.test(channel)||!lines.length||lines.length>10||mentions.length>5||mentions.some(x=>!/^\d{17,22}$/.test(x))||!Number.isInteger(count)||count<1||count>20||!Number.isInteger(delay)||delay<1||delay>3600||everyone&&(count!==1||lines.length!==1)) return json(res,400,{error:'Kiểm tra Channel ID, nội dung, số lượt và delay. @everyone chỉ dùng cho một tin một lần.'});
      const account=String(b.account||'');if(!sessions.get(session).accounts.some(a=>a.id===account))return json(res,400,{error:'Hãy chọn tài khoản đã nhập.'});
      if([...jobs.values()].filter(j=>j.status==='running').length>=5)return json(res,409,{error:'Tối đa 5 tác vụ cùng lúc.'});
      const job={id:randomBytes(8).toString('hex'),session,account,channel,lines,mentions,everyone,count,total:lines.length*count,delay,sent:0,status:'running',lastError:'',timer:null,wake:null};jobs.set(job.id,job);void run(job);return json(res,201,{job:publicJob(job)});
    }catch(e){return json(res,400,{error:e.message})}
  }
  const match=path.match(/^\/api\/jobs\/([a-f0-9]{16})\/stop$/);
  if(match&&req.method==='POST'){const job=jobs.get(match[1]);if(!job)return json(res,404,{error:'Không tìm thấy tác vụ'});job.status='stopped';if(job.timer){clearTimeout(job.timer);job.wake?.()}return json(res,200,{job:publicJob(job)})}
  return json(res,404,{error:'Không tìm thấy trang'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Listening on ${PORT}`));

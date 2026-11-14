'use strict';
const $ = id => document.getElementById(id);
let loggedIn = false;
let accounts = [];
let channels = [];
let activeTab = 'compose';
function notice(value, isError = false) {
  $('notice').textContent = value || '';
  $('notice').className = isError ? 'notice error' : 'notice';
}
async function api(route, body, method = 'POST') {
  const response = await fetch(route, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'Không xử lý được yêu cầu (' + response.status + ')');
  return value;
}
function showTab(tab) {
  activeTab = tab;
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  showTab(button.dataset.tab);
  if (button.dataset.tab === 'tasks') void loadJobs();
  if (button.dataset.tab === 'accounts') renderAccounts();
};
function setLoggedIn(value) {
  loggedIn = value;
  $('login').hidden = value;
  $('dashboard').hidden = !value;
}
function option(label, value) { return new Option(label, value); }
function renderAccounts() {
  $('accounts').replaceChildren();
  if (!accounts.length) {
    $('accounts').textContent = 'Chưa kết nối ứng dụng Discord. Kiểm tra các biến môi trường trên Render.';
    return;
  }
  for (const account of accounts) {
    const div = document.createElement('div');
    div.className = 'account';
    const title = document.createElement('strong');
    title.textContent = account.name + ' (@' + account.username + ')';
    const id = document.createElement('div');
    id.className = 'meta';
    id.textContent = 'ID ứng dụng: ' + account.id;
    div.append(title, id);
    $('accounts').append(div);
  }
}
async function loadAccounts() {
  const data = await api('/api/accounts', undefined, 'GET');
  accounts = data.accounts;
  const prior = $('accountSelect').value;
  $('accountSelect').replaceChildren(option('Chọn ứng dụng Discord', ''));
  $('taskAccount').replaceChildren(option('Tất cả ứng dụng', ''));
  for (const account of accounts) {
    const label = account.name + ' (@' + account.username + ') · ' + account.id;
    $('accountSelect').add(option(label, account.id));
    $('taskAccount').add(option(label, account.id));
  }
  if (accounts.some(x => x.id === prior)) $('accountSelect').value = prior;
  else if (accounts.length) $('accountSelect').value = accounts[0].id;
  renderAccounts();
}
function selectedChannels() { return [...$('channelSelect').selectedOptions].map(x => x.value).filter(Boolean); }
function countSelected() { $('selectedCount').textContent = selectedChannels().length + ' kênh đã chọn'; }
async function loadChannels() {
  const account = $('accountSelect').value;
  $('channelSelect').replaceChildren();
  channels = [];
  countSelected();
  if (!account) return;
  const result = await api('/api/channels?account=' + encodeURIComponent(account), undefined, 'GET');
  channels = result.channels;
  for (const channel of channels) $('channelSelect').add(option(channel.name + ' (' + channel.id + ')', channel.id));
  countSelected();
  if (!channels.length) notice('Không tìm thấy kênh. Kiểm tra DISCORD_GUILD_IDS và quyền ứng dụng.', true);
  else notice('Đã tải ' + channels.length + ' kênh.');
}
function renderJobs(items) {
  $('jobs').replaceChildren();
  const running = items.filter(x => x.status === 'running').length;
  $('taskSummary').textContent = items.length + ' tác vụ · ' + running + ' đang chạy';
  if (!items.length) $('jobs').textContent = 'Chưa có tác vụ cho tài khoản này.';
  for (const job of items) {
    const row = document.createElement('div');
    row.className = 'job';
    const header = document.createElement('div');
    header.className = 'job-header';
    const title = document.createElement('strong');
    title.textContent = job.accountName + ' · ' + job.status;
    const progress = document.createElement('strong');
    progress.textContent = job.sent + '/' + job.total + ' tin đã gửi';
    header.append(title, progress);
    const detail = document.createElement('div');
    detail.className = 'meta';
    detail.textContent = job.channels.length + ' kênh · ' + job.failed + ' lỗi · ' + new Date(job.createdAt).toLocaleString('vi-VN');
    row.append(header, detail);
    if (job.errors?.length) {
      const error = document.createElement('div');
      error.className = 'meta error';
      error.textContent = job.errors.slice(-2).map(x => x.channel + ': ' + x.reason).join(' | ');
      row.append(error);
    }
    if (job.status === 'running') {
      const stop = document.createElement('button');
      stop.className = 'secondary compact';
      stop.textContent = 'Dừng tác vụ';
      stop.onclick = async () => {
        stop.disabled = true;
        try { await api('/api/jobs/' + job.id + '/stop'); await loadJobs(); }
        catch (error) { notice(error.message, true); stop.disabled = false; }
      };
      row.append(stop);
    }
    $('jobs').append(row);
  }
}
async function loadJobs() {
  if (!loggedIn) return;
  const account = $('taskAccount').value;
  const data = await api('/api/jobs' + (account ? '?account=' + encodeURIComponent(account) : ''), undefined, 'GET');
  renderJobs(data.jobs);
}
$('loginForm').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/login', { password: $('password').value });
    $('password').value = '';
    setLoggedIn(true);
    await loadAccounts();
    await loadChannels();
    await loadJobs();
    notice('');
  } catch (error) { notice(error.message, true); }
};
$('logout').onclick = async () => {
  try { await api('/api/logout'); setLoggedIn(false); notice('Đã đăng xuất. Tác vụ đã tạo vẫn chạy cho đến khi kết thúc hoặc máy chủ khởi động lại.'); }
  catch (error) { notice(error.message, true); }
};
$('accountSelect').onchange = async () => {
  try { await loadChannels(); $('taskAccount').value = $('accountSelect').value; await loadJobs(); }
  catch (error) { notice(error.message, true); }
};
$('taskAccount').onchange = () => loadJobs().catch(error => notice(error.message, true));
$('channelSelect').onchange = countSelected;
$('loadChannels').onclick = () => loadChannels().catch(error => notice(error.message, true));
$('refreshTasks').onclick = () => loadJobs().catch(error => notice(error.message, true));
$('selectAll').onclick = () => {
  for (const item of $('channelSelect').options) item.selected = true;
  countSelected();
};
$('textFile').onchange = async () => {
  const file = $('textFile').files[0];
  if (!file) return;
  if (file.size > 20000) { notice('Tệp quá lớn.', true); return; }
  $('message').value = (await file.text()).slice(0, 8000);
  notice('Đã nhập nội dung từ tệp.');
};
$('sendForm').onsubmit = async event => {
  event.preventDefault();
  $('submitJob').disabled = true;
  try {
    const result = await api('/api/jobs', {
      account: $('accountSelect').value,
      channels: selectedChannels(),
      content: $('message').value
    });
    $('taskAccount').value = result.job.account;
    showTab('tasks');
    await loadJobs();
    notice('Đã tạo tác vụ. Có thể chuyển sang tài khoản khác trong khi tác vụ đang chạy.');
  } catch (error) { notice(error.message, true); }
  finally { $('submitJob').disabled = false; }
};
showTab('compose');
loadAccounts().then(async () => {
  setLoggedIn(true);
  await loadChannels();
  await loadJobs();
}).catch(() => setLoggedIn(false));
setInterval(() => { if (loggedIn && activeTab === 'tasks') loadJobs().catch(() => {}); }, 3000);

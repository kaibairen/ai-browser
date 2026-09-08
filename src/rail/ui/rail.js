const surface = document.getElementById('surface');
const form = document.getElementById('open-form');
const input = document.getElementById('open-input');
const computerStatus = document.getElementById('computer-status');
const cancelForm = document.getElementById('cancel-form');
const cancelUrl = document.getElementById('cancel-url');
const mentionButton = document.getElementById('mention');
const collapseButton = document.getElementById('collapse');
const expandButton = document.getElementById('expand');
const DEFAULT_CANCEL = 'https://vip.iqiyi.com/viphelpdesk.html';

let collapsed = false;
let lastState = null;
let lastBoxKey = '';

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return response.json();
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function field(name, label, value, type = 'text') {
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${escapeAttr(value)}" /></label>`;
}

function isBlankUrl(url) {
  const value = String(url || '').trim();
  return !value || value === 'about:blank' || value === 'about:newtab' || value.startsWith('chrome://newtab');
}

function computerLine(state) {
  if (state.engine?.status === 'not-open') return '引擎未打开';
  const url = state.engine?.url || '';
  if (isBlankUrl(url)) return '这台电脑还是空白页。';
  const name = String(state.engine?.site || '').trim();
  if (name) return `这台电脑正在浏览 ${name}`;
  try {
    return `这台电脑正在浏览 ${new URL(url).hostname.replace(/^www\./, '')}`;
  } catch {
    return '这台电脑正在浏览该页';
  }
}

function railBox(width, height) {
  const margin = 16;
  const slack = 28;
  const availW = window.screen.availWidth || window.screen.width || 1280;
  const availH = window.screen.availHeight || window.screen.height || 800;
  const w = Math.min(width, Math.max(40, availW - margin * 2));
  const h = Math.min(height, Math.max(80, availH - margin * 2));
  const left = Math.max(margin, availW - w - slack - margin);
  const top = Math.max(margin, Math.min(36, Math.round(availH * 0.05)));
  return { left, top, width: w, height: h };
}

function shapeFor(state) {
  if (collapsed) return railBox(44, 132);
  if (state?.proposal) return railBox(252, 460);
  if (state?.mention) return railBox(252, 340);
  return railBox(252, 248);
}

function fitRailWindow(state, force = false) {
  const box = shapeFor(state);
  const key = `${collapsed ? 'c' : 'e'}:${box.left},${box.top},${box.width},${box.height}`;
  if (!force && key === lastBoxKey) return;
  lastBoxKey = key;
  try {
    window.resizeTo(box.width, box.height);
    window.moveTo(box.left, box.top);
  } catch {
    // App windows usually allow this; CDP placement is the backup.
  }
}

function releaseFocus() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') {
    active.blur();
  }
  if (document.body && typeof document.body.focus === 'function') {
    document.body.focus();
  }
}

function setCollapsed(next) {
  collapsed = Boolean(next);
  document.title = '左侧打开';
  document.body.classList.toggle('collapsed', collapsed);
  if (expandButton) {
    expandButton.hidden = !collapsed;
    expandButton.textContent = '左侧打开';
  }
  lastBoxKey = '';
  fitRailWindow(lastState, true);
  post(collapsed ? '/rail-collapse' : '/rail-expand').catch(() => {});
  releaseFocus();
}

function renderMention(mention) {
  if (!cancelForm || !mentionButton || !cancelUrl) return;
  if (!mention) {
    cancelForm.hidden = true;
    mentionButton.textContent = '';
    return;
  }
  const url = mention.cancelUrl || DEFAULT_CANCEL;
  if (cancelUrl.value !== url) cancelUrl.value = url;
  if (mentionButton.textContent !== mention.text) mentionButton.textContent = mention.text;
  cancelForm.hidden = false;
}

function render(state) {
  lastState = state;
  if (computerStatus) computerStatus.textContent = computerLine(state);
  const parts = [];
  if (state.proposal?.kind === 'save') {
    const p = state.proposal;
    parts.push(`
      <article class="card" data-kind="save">
        <p>确认保存 ${escapeText(p.siteName)} 的身份与到期日</p>
        ${field('phone', '手机', p.phone)}
        ${field('username', '用户名', p.username)}
        ${field('loginMethod', '登录方式', p.loginMethod)}
        ${field('expiresAt', '到期日', p.expiresAt, 'date')}
        <label><span>密码（可选，不会以明文显示）</span><input name="password" type="password" autocomplete="new-password" /></label>
        <div class="row">
          <button type="button" class="primary" data-action="confirm-save">确认写入</button>
          <button type="button" data-action="dismiss-save">不保存</button>
        </div>
      </article>
    `);
  }
  if (state.proposal?.kind === 'fill') {
    const p = state.proposal;
    parts.push(`
      <article class="card">
        <p>确认填写 ${escapeText(p.siteName)} 已保存的身份</p>
        <p>手机 ${escapeText(p.phone || '—')}</p>
        <p>用户名 ${escapeText(p.username || '—')}</p>
        <p>登录方式 ${escapeText(p.loginMethod || '—')}</p>
        <p class="password">${p.passwordStored ? '••••••••' : ''}</p>
        <label><span>填写密码到页面（不提交，不以明文回显）</span><input name="fillPassword" type="password" autocomplete="off" /></label>
        <div class="row">
          <button type="button" class="primary" data-action="confirm-fill">确认填写</button>
          <button type="button" data-action="dismiss-fill">不填写</button>
        </div>
      </article>
    `);
  }
  surface.innerHTML = parts.join('');
  if (!collapsed) fitRailWindow(state);
}

let opening = false;

async function submitOpen() {
  const value = input.value.trim();
  if (!value || opening) return;
  opening = true;
  try {
    await post('/open', { input: value });
  } finally {
    opening = false;
  }
}

function isEnterKey(event) {
  return (
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter' ||
    event.keyCode === 13 ||
    event.which === 13 ||
    ((event.key === 'Process' || event.keyCode === 229) &&
      (event.code === 'Enter' || event.code === 'NumpadEnter' || event.key === 'Enter'))
  );
}

function isOpenField(event) {
  const target = event.target;
  if (target === input || document.activeElement === input) return true;
  if (target && typeof target.closest === 'function' && target.closest('#open-input, #open-form')) {
    return true;
  }
  // IME can move the first Enter onto body while 「爱奇艺」 is already in the input.
  const active = document.activeElement;
  return Boolean(
    input.value.trim() &&
      (active === document.body || active === document.documentElement || active == null),
  );
}

let openAfterIme = false;

function handleOpenEnter(event) {
  if (!isEnterKey(event)) return;
  if (!isOpenField(event)) return;
  if (!input.value.trim()) return;
  // Chrome IME: first Enter is keydown 229 / Process. preventDefault here
  // swallows it and /open never fires. Post now; keyup/compositionend are backups.
  if (event.type === 'keydown' && (event.isComposing || event.keyCode === 229 || event.key === 'Process')) {
    openAfterIme = true;
    submitOpen();
    return;
  }
  openAfterIme = false;
  event.preventDefault();
  event.stopPropagation();
  submitOpen();
}

function traceClick(stage, extra) {
  post('/click-trace', {
    stage,
    url: cancelUrl?.value || DEFAULT_CANCEL,
    ...extra,
  }).catch(() => {});
}

function submitCancel() {
  const url = cancelUrl?.value || DEFAULT_CANCEL;
  traceClick('mention-click', { url });
  post('/open-cancel', { url }).catch(() => {});
  cancelForm?.submit();
}

if (cancelForm) {
  cancelForm.addEventListener('submit', () => {
    const url = cancelUrl?.value || DEFAULT_CANCEL;
    traceClick('form-submit', { url });
    post('/open-cancel', { url }).catch(() => {});
  });
}

if (mentionButton) {
  mentionButton.addEventListener('click', submitCancel);
}

if (collapseButton) {
  collapseButton.addEventListener('click', () => setCollapsed(true));
}

if (expandButton) {
  expandButton.addEventListener('click', () => setCollapsed(false));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitOpen();
});

document.addEventListener('keydown', handleOpenEnter, true);
document.addEventListener('keyup', handleOpenEnter, true);
document.addEventListener('keypress', handleOpenEnter, true);
input.addEventListener('keydown', handleOpenEnter);
input.addEventListener('keyup', handleOpenEnter);
input.addEventListener('keypress', handleOpenEnter);
input.addEventListener('compositionend', () => {
  if (!openAfterIme || !input.value.trim()) {
    openAfterIme = false;
    return;
  }
  openAfterIme = false;
  submitOpen();
});

surface.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'confirm-save') {
    const card = surface.querySelector('[data-kind="save"]');
    const data = {};
    for (const fieldEl of card.querySelectorAll('input[name]')) {
      data[fieldEl.name] = fieldEl.type === 'checkbox' ? fieldEl.checked : fieldEl.value;
    }
    await post('/confirm-save', {
      phone: data.phone,
      username: data.username,
      loginMethod: data.loginMethod,
      expiresAt: data.expiresAt,
      password: data.password || '',
    });
    return;
  }
  if (action === 'confirm-fill') {
    const card = event.target.closest('article');
    const passwordEl = card?.querySelector('input[name="fillPassword"]');
    await post('/confirm-fill', { password: passwordEl?.value || '' });
    return;
  }
  await post(`/${action}`);
});

async function boot() {
  document.title = '左侧打开';
  document.body.tabIndex = -1;
  let launchGuard = true;
  input.addEventListener('pointerdown', () => {
    launchGuard = false;
  }, true);
  input.addEventListener('focus', () => {
    if (launchGuard) releaseFocus();
  });
  setTimeout(() => {
    launchGuard = false;
  }, 1000);
  fitRailWindow(null, true);
  releaseFocus();
  const state = await (await fetch('/state')).json();
  renderMention(state.mention);
  render(state);
  releaseFocus();
  requestAnimationFrame(releaseFocus);
  setTimeout(releaseFocus, 200);
  const stream = new EventSource('/events');
  stream.onmessage = (event) => {
    const next = JSON.parse(event.data);
    renderMention(next.mention);
    if (document.activeElement && document.activeElement.type === 'password') return;
    render(next);
  };
}

boot();

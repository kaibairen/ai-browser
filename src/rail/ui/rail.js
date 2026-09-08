const surface = document.getElementById('surface');
const form = document.getElementById('open-form');
const input = document.getElementById('open-input');
const engineStatus = document.getElementById('engine-status');
const cancelForm = document.getElementById('cancel-form');
const cancelUrl = document.getElementById('cancel-url');
const mentionButton = document.getElementById('mention');

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

function renderMention(mention) {
  if (!cancelForm || !mentionButton || !cancelUrl) return;
  if (!mention) {
    cancelForm.hidden = true;
    mentionButton.textContent = '';
    return;
  }
  const url = mention.cancelUrl || 'https://vip.iqiyi.com/';
  if (cancelUrl.value !== url) cancelUrl.value = url;
  if (mentionButton.textContent !== mention.text) mentionButton.textContent = mention.text;
  cancelForm.hidden = false;
}

function render(state) {
  if (engineStatus) {
    const closed = state.engine?.status === 'not-open';
    engineStatus.hidden = !closed;
    engineStatus.textContent = closed ? '引擎未打开' : '';
  }
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
  if (!parts.length) {
    parts.push('<p class="muted"></p>');
  }
  surface.innerHTML = parts.join('');
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
    event.keyCode === 13
  );
}

function traceClick(stage, extra) {
  post('/click-trace', {
    stage,
    url: cancelUrl?.value || 'https://vip.iqiyi.com/',
    ...extra,
  }).catch(() => {});
}

if (cancelForm) {
  cancelForm.addEventListener('submit', () => {
    const url = cancelUrl?.value || 'https://vip.iqiyi.com/';
    traceClick('form-submit', { url });
    post('/open-cancel', { url }).catch(() => {});
  });
}

if (mentionButton) {
  mentionButton.addEventListener('click', () => {
    traceClick('mention-click');
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitOpen();
});

document.addEventListener(
  'keydown',
  (event) => {
    if (!isEnterKey(event)) return;
    if (event.target !== input) return;
    if (!input.value.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    submitOpen();
  },
  true,
);

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
  const state = await (await fetch('/state')).json();
  renderMention(state.mention);
  render(state);
  const stream = new EventSource('/events');
  stream.onmessage = (event) => {
    const next = JSON.parse(event.data);
    renderMention(next.mention);
    if (document.activeElement && document.activeElement.type === 'password') return;
    render(next);
  };
}

boot();

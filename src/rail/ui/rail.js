const surface = document.getElementById('surface');
const form = document.getElementById('open-form');
const input = document.getElementById('open-input');

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

function render(state) {
  const parts = [];
  if (state.mention) {
    parts.push(
      `<article class="card mention" data-action="open-cancel">${escapeText(state.mention.text)}</article>`,
    );
  }
  if (state.proposal?.kind === 'save') {
    const p = state.proposal;
    parts.push(`
      <article class="card" data-kind="save">
        <p>确认保存 ${escapeText(p.siteName)} 的身份与到期日</p>
        ${field('phone', '手机', p.phone)}
        ${field('username', '用户名', p.username)}
        ${field('loginMethod', '登录方式', p.loginMethod)}
        ${field('expiresAt', '到期日', p.expiresAt, 'date')}
        <p class="muted password">${p.passwordPresent ? '密码（可选，明文不会出现在这里）' : ''}</p>
        ${p.passwordPresent ? '<label><input name="savePassword" type="checkbox" /> 同时保存密码</label>' : ''}
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input.value.trim()) return;
  await post('/open', { input: input.value.trim() });
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
      savePassword: Boolean(data.savePassword),
    });
    return;
  }
  await post(`/${action}`);
});

async function boot() {
  render(await (await fetch('/state')).json());
  const stream = new EventSource('/events');
  stream.onmessage = (event) => render(JSON.parse(event.data));
}

boot();

// Injected into every frame. Reports actions only; never writes, fills, or submits.
export const OBSERVER_SOURCE = `(() => {
  if (window.__aiBrowserObserved) return;
  window.__aiBrowserObserved = true;

  const send = (action, extra) => {
    try {
      if (typeof aiBrowserReport === 'function') {
        aiBrowserReport(JSON.stringify({
          action,
          href: location.href,
          frame: window === window.top ? 'top' : 'iframe',
          ...extra
        }));
      }
    } catch (_error) {
      // Observation must never break the page.
    }
  };

  const meta = (el) => ({
    tag: el && el.tagName ? el.tagName : '',
    type: el && el.type ? el.type : '',
    name: el && el.name ? el.name : '',
    id: el && el.id ? el.id : ''
  });

  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest
      ? event.target.closest('a,button,input,summary,[role="button"]')
      : event.target;
    send('click', { meta: meta(target) });
  }, true);

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target && target.matches && target.matches('input,select,textarea')) {
      send('focus', { meta: meta(target) });
    }
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target && target.matches && target.matches('input,select,textarea')) {
      send('input', { meta: meta(target), hasValue: Boolean(target.value) });
    }
  }, true);

  document.addEventListener('submit', () => {
    send('submit-observed');
  }, true);

  send('frame-ready');
})();`;

// Current visible surface wins. Tab copy like 手机号登录 must not stick
// when the page is showing 扫码 / a QR widget.
export function resolveObservedLoginMethod({
  text = '',
  qrVisible = false,
  phoneVisible = false,
  passwordVisible = false,
  phone = '',
  username = '',
} = {}) {
  if (qrVisible || (!phoneVisible && !passwordVisible && /扫码登录|二维码登录|扫一扫/.test(text))) {
    return 'qr';
  }
  if (/验证码|短信登录|手机号登录/.test(text)) return 'phone';
  if (/密码登录|账号登录/.test(text)) return phone ? 'phone' : 'username';
  if (/扫码登录|二维码/.test(text)) return 'qr';
  if (phone) return 'phone';
  if (username) return 'username';
  return '';
}

// Observation already has loginMethod. Frames only fill gaps — never
// replace a top-level method, and never invent a new field.
export function mergeObservationSnapshots(top, frames = []) {
  const merged = {
    href: '',
    phone: '',
    username: '',
    loginMethod: '',
    passwordPresent: false,
    passwordValue: '',
    expiresAt: '',
    loginForm: false,
    ...(top || {}),
    fields: { ...(top?.fields || {}) },
  };

  const takeIdentity = (child) => {
    if (!child) return;
    if (!merged.phone && child.phone) merged.phone = child.phone;
    if (!merged.username && child.username) merged.username = child.username;
    if (!merged.expiresAt && child.expiresAt) merged.expiresAt = child.expiresAt;
    if (child.passwordPresent) merged.passwordPresent = true;
    if (!merged.passwordValue && child.passwordValue) merged.passwordValue = child.passwordValue;
    if (child.loginForm) merged.loginForm = true;
    if (child.fields) merged.fields = { ...merged.fields, ...child.fields };
  };

  if (merged.loginMethod) {
    for (const child of frames) takeIdentity(child);
    return merged;
  }

  for (const child of frames) {
    takeIdentity(child);
    if (!child?.loginMethod) continue;
    if (child.loginMethod === 'qr') merged.loginMethod = 'qr';
    else if (!merged.loginMethod) merged.loginMethod = child.loginMethod;
  }
  if (merged.loginMethod === 'qr') merged.loginForm = true;
  return merged;
}

export const SNAPSHOT_SOURCE = `(() => {
  const resolveObservedLoginMethod = ${resolveObservedLoginMethod.toString()};

  const labelOf = (el) => [
    el.type || '',
    el.name || '',
    el.id || '',
    el.placeholder || '',
    el.getAttribute('autocomplete') || '',
    el.getAttribute('aria-label') || ''
  ].join(' ').toLowerCase();

  const selectorOf = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name.replace(/"/g, '') + '"]';
    if (el.type) return 'input[type="' + el.type + '"]';
    return el.tagName.toLowerCase();
  };

  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const box = el.getBoundingClientRect();
    return box.width >= 32 && box.height >= 32 && box.bottom > 0 && box.right > 0;
  };

  const hintOf = (el) => [
    el.className || '',
    el.id || '',
    el.alt || '',
    el.title || '',
    el.getAttribute('src') || '',
    el.getAttribute('aria-label') || ''
  ].join(' ').toLowerCase();

  const fields = {};
  const result = {
    href: location.href,
    phone: '',
    username: '',
    loginMethod: '',
    passwordPresent: false,
    passwordValue: '',
    expiresAt: '',
    loginForm: false,
    fields
  };

  let phoneVisible = false;
  let passwordVisible = false;

  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = String(el.type || '').toLowerCase();
    const label = labelOf(el);
    const value = el.value || '';

    if (type === 'password' || /password|pwd|密码/.test(label)) {
      result.passwordPresent = Boolean(value);
      result.passwordValue = value;
      fields.password = selectorOf(el);
      result.loginForm = true;
      if (isVisible(el)) passwordVisible = true;
      continue;
    }
    if (type === 'tel' || /phone|mobile|tel|手机|电话/.test(label)) {
      result.phone = value || result.phone;
      fields.phone = selectorOf(el);
      result.loginForm = true;
      if (isVisible(el)) phoneVisible = true;
      continue;
    }
    if (type === 'text' || type === 'email' || type === 'number' || type === '') {
      if (/user|account|nick|email|login|用户|账号|帐号|昵称/.test(label)) {
        result.username = value || result.username;
        fields.username = selectorOf(el);
        result.loginForm = true;
      }
    }
  }

  let qrVisible = false;
  for (const el of document.querySelectorAll('img,canvas,svg,iframe,[class*="qr" i],[id*="qr" i],[class*="erweima" i],[id*="erweima" i]')) {
    if (/qr|二维码|扫码|erweima|ewm/.test(hintOf(el)) && isVisible(el)) {
      qrVisible = true;
      break;
    }
  }

  const text = (document.body && document.body.innerText || '').slice(0, 20000);
  result.loginMethod = resolveObservedLoginMethod({
    text,
    qrVisible,
    phoneVisible,
    passwordVisible,
    phone: result.phone,
    username: result.username,
  });
  if (result.loginMethod === 'qr') result.loginForm = true;

  const expiry =
    text.match(/(?:到期|有效期|会员至|有效期至)[^\\d]{0,6}(\\d{4}[-./年]\\d{1,2}[-./月]\\d{1,2})/) ||
    text.match(/(\\d{4}[-./年]\\d{1,2}[-./月]\\d{1,2})[^\\d]{0,4}到期/);
  if (expiry) {
    result.expiresAt = expiry[1]
      .replace(/年|月|\\./g, '-')
      .replace(/日/g, '')
      .replace(/-(\\d)$/g, '-0$1')
      .replace(/-(\\d)-/g, '-0$1-');
  }

  return result;
})()`;

export const FILL_SOURCE = `(selectors, values) => {
  const filled = [];
  const write = (el, value, label) => {
    if (!el || value == null || value === '') return;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(label);
  };
  const find = (selector, extra) => {
    if (selector) {
      const chosen = document.querySelector(selector);
      if (chosen) return chosen;
    }
    return extra ? document.querySelector(extra) : null;
  };
  write(find(selectors.phone, 'input[type="tel"],input[name*="phone" i],input[placeholder*="手机"]'), values.phone, 'phone');
  write(find(selectors.username, 'input[type="text"],input[type="email"],input[name*="user" i]'), values.username, 'username');
  const passwordEl = find(selectors.password, 'input[type="password"]');
  if (passwordEl) write(passwordEl, values.password, 'password');
  return filled;
}`;

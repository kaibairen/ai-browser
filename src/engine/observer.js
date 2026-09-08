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

export const SNAPSHOT_SOURCE = `(() => {
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

  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = String(el.type || '').toLowerCase();
    const label = labelOf(el);
    const value = el.value || '';

    if (type === 'password' || /password|pwd|密码/.test(label)) {
      result.passwordPresent = Boolean(value);
      result.passwordValue = value;
      fields.password = selectorOf(el);
      result.loginForm = true;
      continue;
    }
    if (type === 'tel' || /phone|mobile|tel|手机|电话/.test(label)) {
      result.phone = value || result.phone;
      fields.phone = selectorOf(el);
      result.loginForm = true;
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

  const text = (document.body && document.body.innerText || '').slice(0, 20000);
  if (/验证码|短信登录|手机号登录/.test(text)) result.loginMethod = result.loginMethod || 'phone';
  if (/密码登录|账号登录/.test(text)) result.loginMethod = result.loginMethod || (result.phone ? 'phone' : 'username');
  if (/扫码登录|二维码/.test(text)) result.loginMethod = result.loginMethod || 'qr';
  if (result.phone && !result.loginMethod) result.loginMethod = 'phone';
  if (result.username && !result.loginMethod) result.loginMethod = 'username';

  const expiry =
    text.match(/(?:到期|有效期|会员至|有效期至)[^\d]{0,6}(\d{4}[-./年]\d{1,2}[-./月]\d{1,2})/) ||
    text.match(/(\d{4}[-./年]\d{1,2}[-./月]\d{1,2})[^\d]{0,4}到期/);
  if (expiry) {
    result.expiresAt = expiry[1]
      .replace(/年|月|\./g, '-')
      .replace(/日/g, '')
      .replace(/-(\d)$/g, '-0$1')
      .replace(/-(\d)-/g, '-0$1-');
  }

  return result;
})()`;

export const FILL_SOURCE = `(selectors, values) => {
  const filled = [];
  const setValue = (selector, value) => {
    if (!selector || value == null || value === '') return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(selector);
  };
  setValue(selectors.phone, values.phone);
  setValue(selectors.username, values.username);
  setValue(selectors.password, values.password);
  return filled;
}`;

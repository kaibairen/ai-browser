import { loginMethodFromPageSignals } from './login-method.js';

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
  const loginMethodFromPageSignals = ${loginMethodFromPageSignals.toString()};

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

  const isShown = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const cls = String(node.className || '');
      if (/\\b(fn-hide|hidden|hide|dn|d-none|invisible|ng-hide)\\b/i.test(cls)) return false;
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = node.style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      try {
        const cs = node.ownerDocument.defaultView.getComputedStyle(node);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      } catch (_error) {
        // Computed style may be unavailable in some frames.
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
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

  let visiblePhoneField = false;
  let visiblePasswordField = false;
  let visibleUsernameField = false;

  for (const el of document.querySelectorAll('input, select, textarea')) {
    const type = String(el.type || '').toLowerCase();
    const label = labelOf(el);
    const value = el.value || '';
    const shown = isShown(el);

    if (type === 'password' || /password|pwd|密码/.test(label)) {
      result.passwordPresent = Boolean(value);
      result.passwordValue = value;
      fields.password = selectorOf(el);
      result.loginForm = true;
      if (shown) visiblePasswordField = true;
      continue;
    }
    if (type === 'tel' || /phone|mobile|tel|手机|电话/.test(label)) {
      result.phone = value || result.phone;
      fields.phone = selectorOf(el);
      result.loginForm = true;
      if (shown) visiblePhoneField = true;
      continue;
    }
    if (type === 'text' || type === 'email' || type === 'number' || type === '') {
      if (/user|account|nick|email|login|用户|账号|帐号|昵称/.test(label)) {
        result.username = value || result.username;
        fields.username = selectorOf(el);
        result.loginForm = true;
        if (shown) visibleUsernameField = true;
      }
    }
  }

  let selectedTab = '';
  const tabNodes = document.querySelectorAll(
    '[role="tab"], [class*="tab"] li, [class*="tab"] a, [class*="tab"] button, [class*="Tab"] li, [id*="loginMethod"] li, [id*="loginMethod"] a, [class*="loginMethod"] li, [class*="login-method"] *'
  );
  for (const el of tabNodes) {
    const text = String(el.innerText || el.textContent || '').replace(/\\s+/g, '').trim();
    if (!text || text.length > 20) continue;
    if (!/扫码|二维码|手机|短信|验证码|密码|账号|帐号|用户名/.test(text)) continue;
    const selected =
      el.getAttribute('aria-selected') === 'true' ||
      Boolean(el.getAttribute('aria-current')) ||
      /\\b(active|selected|current|checked|on)\\b/i.test(String(el.className || ''));
    if (selected && isShown(el)) {
      selectedTab = text;
      break;
    }
  }

  let visibleQr = false;
  const qrNodes = document.querySelectorAll(
    'img, canvas, svg, [class*="qr" i], [id*="qr" i], [class*="qrcode" i], [id*="qrcode" i]'
  );
  for (const el of qrNodes) {
    if (!isShown(el)) continue;
    const hint = [
      el.id,
      el.className,
      el.getAttribute('alt') || '',
      el.getAttribute('title') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('src') || ''
    ].join(' ');
    if (/qr|qrcode|二维码|扫码/i.test(hint)) {
      visibleQr = true;
      break;
    }
    if (el.tagName === 'CANVAS' || el.tagName === 'IMG') {
      const box = el.getBoundingClientRect();
      const square = Math.abs(box.width - box.height) < box.width * 0.25;
      const sized = box.width >= 80 && box.width <= 400;
      if (square && sized && el.closest('[class*="login" i], [id*="login" i], [class*="qr" i], [id*="qr" i]')) {
        visibleQr = true;
        break;
      }
    }
  }

  const text = (document.body && document.body.innerText || '').slice(0, 20000);
  result.loginMethod = loginMethodFromPageSignals({
    visibleQr,
    selectedTab,
    visiblePhoneField,
    visiblePasswordField,
    visibleUsernameField,
    pageText: text
  });
  if (result.loginMethod) result.loginForm = true;

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

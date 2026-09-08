import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInputKind,
  FILL_SOURCE,
  fillIdentityFields,
  mergeObservationSnapshots,
  resolveFillField,
  resolveObservedLoginMethod,
} from './observer.js';

function makeInput(attrs) {
  return {
    tagName: 'INPUT',
    type: attrs.type || 'text',
    name: attrs.name || '',
    id: attrs.id || '',
    placeholder: attrs.placeholder || '',
    title: attrs.title || '',
    className: attrs.className || '',
    autocomplete: attrs.autocomplete || '',
    value: attrs.value || '',
    focused: false,
    events: [],
    getAttribute(name) {
      if (name === 'autocomplete') return this.autocomplete;
      if (name === 'aria-label') return attrs.ariaLabel || '';
      return this[name] || '';
    },
    focus() {
      this.focused = true;
    },
    dispatchEvent(event) {
      this.events.push(event.type);
    },
  };
}

function matchesSelector(el, selector) {
  if (!selector) return false;
  if (selector.includes(',')) {
    return selector.split(',').some((part) => matchesSelector(el, part.trim()));
  }
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  const name = selector.match(/\[name="([^"]+)"\]/);
  if (name) return el.name === name[1];
  const type = selector.match(/\[type="([^"]+)"\]/);
  if (type) return (el.type || 'text') === type[1];
  const placeholder = selector.match(/\[placeholder="([^"]+)"\]/);
  if (placeholder) return el.placeholder === placeholder[1];
  return false;
}

function makeDocument(inputs) {
  return {
    querySelector(selector) {
      return inputs.find((el) => matchesSelector(el, selector)) || null;
    },
    querySelectorAll() {
      return inputs;
    },
  };
}

test('current QR surface is qr even when 手机号登录 copy is also on the page', () => {
  assert.equal(
    resolveObservedLoginMethod({
      text: '扫码登录 手机号登录 打开爱奇艺扫一扫',
      qrVisible: true,
      phoneVisible: false,
    }),
    'qr',
  );
});

test('hidden phone tab plus 扫码登录 copy is qr, not leftover phone', () => {
  assert.equal(
    resolveObservedLoginMethod({
      text: '验证码 短信登录 手机号登录 扫码登录',
      qrVisible: false,
      phoneVisible: false,
      passwordVisible: false,
    }),
    'qr',
  );
});

test('visible phone form stays phone when QR is not the current surface', () => {
  assert.equal(
    resolveObservedLoginMethod({
      text: '扫码登录 手机号登录',
      qrVisible: false,
      phoneVisible: true,
    }),
    'phone',
  );
});

test('frame merge fills empty loginMethod with iframe qr and keeps a missed phone', () => {
  const merged = mergeObservationSnapshots(
    { loginMethod: '', phone: '', loginForm: false, fields: {} },
    [{ loginMethod: 'phone', phone: '13800138000' }, { loginMethod: 'qr', loginForm: true }],
  );
  assert.equal(merged.loginMethod, 'qr');
  assert.equal(merged.phone, '13800138000');
  assert.equal(merged.loginForm, true);
});

test('frame merge does not replace a top-level loginMethod', () => {
  const merged = mergeObservationSnapshots(
    { loginMethod: 'qr', phone: '', fields: {} },
    [{ loginMethod: 'phone', phone: '13900000000' }],
  );
  assert.equal(merged.loginMethod, 'qr');
  assert.equal(merged.phone, '13900000000');
});

test('search box is not a username field even when it is the first text input', () => {
  const search = makeInput({ name: 'q', placeholder: '搜索' });
  const phone = makeInput({ type: 'tel', name: 'phone', placeholder: '手机号' });
  const username = makeInput({ name: 'userName', placeholder: '用户名' });
  assert.equal(classifyInputKind(search), 'search');
  assert.equal(classifyInputKind(phone), 'phone');
  assert.equal(classifyInputKind(username), 'username');
  assert.equal(resolveFillField('username', [search, phone, username], search), username);
  assert.equal(resolveFillField('username', [search, phone], search), null);
});

test('confirm fill writes tester to the page username field, not the search box', () => {
  const search = makeInput({ name: 'q', placeholder: '搜索' });
  const phone = makeInput({ type: 'tel', name: 'phone', placeholder: '手机号' });
  const username = makeInput({ name: 'userName', placeholder: '用户名' });
  const filled = fillIdentityFields(
    makeDocument([search, phone, username]),
    { phone: 'input[name="phone"]', username: 'input[type="text"]' },
    { phone: '13800138000', username: 'tester' },
  );
  assert.equal(phone.value, '13800138000');
  assert.equal(username.value, 'tester');
  assert.equal(search.value, '');
  assert.deepEqual(filled, ['phone', 'username']);
  assert.deepEqual(username.events, ['input', 'change']);
  assert.ok(!username.events.includes('submit'));
});

test('confirm fill does not write username into search when the page has no username field', () => {
  const search = makeInput({ name: 'q', placeholder: '搜索' });
  const phone = makeInput({ type: 'tel', placeholder: '手机号' });
  const filled = fillIdentityFields(
    makeDocument([search, phone]),
    { phone: 'input[type="tel"]', username: 'input[type="text"]' },
    { phone: '13800138000', username: 'tester' },
  );
  assert.equal(phone.value, '13800138000');
  assert.equal(search.value, '');
  assert.deepEqual(filled, ['phone']);
});

test('page-injected FILL_SOURCE also refuses to write username into search', () => {
  const fill = eval(`(${FILL_SOURCE})`);
  const search = makeInput({ name: 'q', placeholder: '搜索' });
  const phone = makeInput({ type: 'tel', name: 'phone', placeholder: '手机号' });
  const username = makeInput({ name: 'userName', placeholder: '用户名' });
  const previous = globalThis.document;
  globalThis.document = makeDocument([search, phone, username]);
  try {
    const filled = fill(
      { phone: 'input[type="text"]', username: 'input[type="text"]' },
      { phone: '13800138000', username: 'tester' },
    );
    assert.equal(phone.value, '13800138000');
    assert.equal(username.value, 'tester');
    assert.equal(search.value, '');
    assert.deepEqual(filled, ['phone', 'username']);
  } finally {
    globalThis.document = previous;
  }
});

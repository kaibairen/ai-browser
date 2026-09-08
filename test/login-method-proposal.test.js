import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginMethodFromPageSignals } from '../src/engine/login-method.js';
import { SNAPSHOT_SOURCE } from '../src/engine/observer.js';
import {
  createSessionPolicy,
  loginMethodForSaveProposal,
  phoneForSaveProposal,
} from '../src/rail/policy.js';
import { describeSite, displayLoginMethod, normalizeLoginMethod } from '../src/sites/catalog.js';
import { createSiteStore } from '../src/store/site-store.js';

const SITE = describeSite('https://www.iqiyi.com/vip/');
const QR_PAGE = 'https://passport.iqiyi.com/register/form.html';

function qrSnapshot(extra = {}) {
  return {
    siteKey: SITE.siteKey,
    phone: '',
    username: '',
    loginMethod: '扫码',
    expiresAt: '',
    passwordPresent: false,
    loginForm: true,
    ...extra,
  };
}

test('QR page with 手机号登录 tab text is 扫码, not phone', () => {
  assert.equal(
    loginMethodFromPageSignals({
      visibleQr: true,
      pageText: '扫码登录 手机号登录 密码登录',
    }),
    '扫码',
  );
  assert.equal(
    loginMethodFromPageSignals({
      selectedTab: '扫码登录',
      pageText: '扫码登录 手机号登录 短信登录',
    }),
    '扫码',
  );
  assert.equal(
    loginMethodFromPageSignals({
      pageText: '请使用手机扫描二维码 手机号登录',
    }),
    '扫码',
  );
});

test('selected phone tab still wins when QR is not current', () => {
  assert.equal(
    loginMethodFromPageSignals({
      selectedTab: '手机号登录',
      visiblePhoneField: true,
      pageText: '扫码登录 手机号登录',
    }),
    'phone',
  );
});

test('proposal uses current page 扫码 and keeps a known phone', () => {
  const snapshot = qrSnapshot();
  const record = { phone: '13800138000', username: '', loginMethod: 'phone' };
  assert.equal(loginMethodForSaveProposal(snapshot, record), '扫码');
  assert.equal(phoneForSaveProposal(snapshot, record), '13800138000');
  assert.equal(loginMethodForSaveProposal({ loginMethod: 'qr' }, record), '扫码');
});

test('save proposal on QR page is 扫码 even when the store says phone', () => {
  const policy = createSessionPolicy();
  policy.setSnapshot(qrSnapshot());
  const { proposal } = policy.surface({
    site: SITE,
    record: { phone: '13800138000', username: '', loginMethod: 'phone', expiresAt: '' },
    url: QR_PAGE,
  });
  assert.equal(proposal?.kind, 'save');
  assert.equal(proposal.loginMethod, '扫码');
  assert.equal(proposal.phone, '13800138000');
});

test('QR-only page with no record still proposes 扫码', () => {
  const policy = createSessionPolicy();
  policy.setSnapshot(qrSnapshot({ loginForm: false }));
  const { proposal } = policy.surface({ site: SITE, record: null, url: QR_PAGE });
  assert.equal(proposal?.kind, 'save');
  assert.equal(proposal.loginMethod, '扫码');
});

test('already-saved qr does not keep proposing a save against page 扫码', () => {
  const policy = createSessionPolicy();
  policy.setSnapshot(qrSnapshot());
  const { proposal } = policy.surface({
    site: SITE,
    record: { phone: '13800138000', username: '', loginMethod: 'qr', expiresAt: '' },
    url: QR_PAGE,
  });
  assert.notEqual(proposal?.kind, 'save');
  assert.equal(normalizeLoginMethod('扫码'), 'qr');
  assert.equal(displayLoginMethod('qr'), '扫码');
});

test('confirmWrite still stores the value it is given', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-browser-qr-'));
  const previous = process.env.AI_BROWSER_HOME;
  process.env.AI_BROWSER_HOME = home;
  try {
    const store = createSiteStore();
    await store.load();
    const phone = await store.confirmWrite(
      SITE.siteKey,
      { phone: '13800138000', loginMethod: 'phone' },
      '',
      { caller: 'workspace', confirmed: true },
    );
    assert.equal(phone.loginMethod, 'phone');
    const qr = await store.confirmWrite(
      SITE.siteKey,
      { phone: '13800138000', loginMethod: '扫码' },
      '',
      { caller: 'workspace', confirmed: true },
    );
    assert.equal(qr.loginMethod, 'qr');
    assert.equal(qr.phone, '13800138000');
  } finally {
    if (previous === undefined) delete process.env.AI_BROWSER_HOME;
    else process.env.AI_BROWSER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('injected snapshot source still parses', () => {
  assert.match(SNAPSHOT_SOURCE, /loginMethodFromPageSignals/);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /loginMethod = result\.loginMethod \|\| 'phone'/);
  new Function(`return (${SNAPSHOT_SOURCE});`);
});

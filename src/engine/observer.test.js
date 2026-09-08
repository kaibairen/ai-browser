import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObservationSnapshots, resolveObservedLoginMethod } from './observer.js';

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

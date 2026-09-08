import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPolicy, saveProposalFields } from './policy.js';

const site = {
  siteKey: 'iqiyi.com',
  name: '爱奇艺',
  hosts: ['iqiyi.com'],
  membershipUrl: 'https://www.iqiyi.com/vip/',
};

test('save proposal uses live qr and does not inherit stored phone method', () => {
  const fields = saveProposalFields(
    { loginMethod: 'qr', phone: '', username: '' },
    { loginMethod: 'phone', phone: '13800138000', username: 'nana' },
  );
  assert.equal(fields.loginMethod, 'qr');
  assert.equal(fields.phone, '13800138000');
  assert.equal(fields.username, 'nana');
});

test('empty observation does not fall back to stored phone method', () => {
  const fields = saveProposalFields(
    { loginMethod: '', phone: '13900000000' },
    { loginMethod: 'phone', phone: '13800138000' },
  );
  assert.equal(fields.loginMethod, '');
  assert.equal(fields.phone, '13900000000');
});

test('confirm card before confirmWrite is qr when the current page is 扫码', () => {
  const policy = createSessionPolicy();
  policy.setSnapshot({
    siteKey: 'iqiyi.com',
    phone: '13800138000',
    username: '',
    loginMethod: 'qr',
    expiresAt: '',
    loginForm: true,
  });
  const { proposal } = policy.surface({
    site,
    record: { phone: '13800138000', username: '', loginMethod: 'phone', expiresAt: '' },
    url: 'https://www.iqiyi.com/vip/',
  });
  assert.equal(proposal.kind, 'save');
  assert.equal(proposal.loginMethod, 'qr');
  assert.equal(proposal.phone, '13800138000');
});

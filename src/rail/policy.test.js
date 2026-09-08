import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IQIYI_CANCEL_URL } from '../sites/catalog.js';
import {
  cancelUrlForMention,
  createSessionPolicy,
  expiryMention,
  saveProposalFields,
  shouldMentionExpiry,
} from './policy.js';

const site = {
  siteKey: 'iqiyi.com',
  name: '爱奇艺',
  hosts: ['iqiyi.com'],
  membershipUrl: 'https://www.iqiyi.com/vip/',
  cancelUrl: IQIYI_CANCEL_URL,
};

const now = new Date('2026-09-08T12:00:00');

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

test('stored expiry within 7 days including today is mentioned once as one sentence', () => {
  const today = { expiresAt: '2026-09-08', expiryMentionedFor: '' };
  const soon = { expiresAt: '2026-09-12', expiryMentionedFor: '' };
  const far = { expiresAt: '2026-12-01', expiryMentionedFor: '' };

  assert.equal(shouldMentionExpiry(today, now), true);
  assert.equal(shouldMentionExpiry(soon, now), true);
  assert.equal(shouldMentionExpiry(far, now), false);

  const policy = createSessionPolicy();
  const { mention } = policy.surface({
    site,
    record: soon,
    url: 'https://www.iqiyi.com/vip/',
    now,
  });
  assert.equal(mention.text, '爱奇艺会员将于 2026-09-12 到期');
  assert.equal(mention.cancelUrl, IQIYI_CANCEL_URL);
  assert.ok(!/https?:\/\//.test(mention.text));
  assert.equal(expiryMention(soon, site).text, mention.text);
});

test('same expiresAt is mentioned only once after shown or clicked', () => {
  const record = { expiresAt: '2026-09-12', expiryMentionedFor: '' };
  const policy = createSessionPolicy();
  const first = policy.surface({
    site,
    record,
    url: 'about:blank',
    records: [{ site, record }],
    now,
  });
  assert.equal(first.mention.text, '爱奇艺会员将于 2026-09-12 到期');

  const stillShowing = policy.surface({
    site,
    record: { ...record, expiryMentionedFor: '2026-09-12' },
    url: 'about:blank',
    now,
  });
  assert.equal(stillShowing.mention.text, first.mention.text);
  assert.equal(cancelUrlForMention(stillShowing.mention), IQIYI_CANCEL_URL);

  const clicked = policy.consumeMention();
  assert.equal(clicked.cancelUrl, IQIYI_CANCEL_URL);
  assert.equal(cancelUrlForMention(clicked), IQIYI_CANCEL_URL);

  const afterClick = policy.surface({
    site,
    record: { ...record, expiryMentionedFor: '2026-09-12' },
    url: 'about:blank',
    now,
  });
  assert.equal(afterClick.mention, null);
  assert.equal(cancelUrlForMention(afterClick.mention), '');

  const nextSession = createSessionPolicy().surface({
    site,
    record: { ...record, expiryMentionedFor: '2026-09-12' },
    url: 'https://www.iqiyi.com/vip/',
    now,
  });
  assert.equal(nextSession.mention, null);
  assert.equal(cancelUrlForMention(nextSession.mention), '');
});

test('without the mention sentence there is no cancel URL to open', () => {
  assert.equal(cancelUrlForMention(null), '');
  assert.equal(cancelUrlForMention(undefined), '');
  const quiet = createSessionPolicy().surface({
    site,
    record: { expiresAt: '2026-12-01', expiryMentionedFor: '' },
    url: 'https://www.iqiyi.com/vip/',
    now,
  });
  assert.equal(quiet.mention, null);
  assert.equal(cancelUrlForMention(quiet.mention), '');
});

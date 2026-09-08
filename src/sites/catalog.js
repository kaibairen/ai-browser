export const IQIYI_CANCEL_URL = 'https://vip.iqiyi.com/viphelpdesk.html';

export const LOGIN_METHODS = {
  phone: 'phone',
  username: 'username',
  qr: 'qr',
};

const BROWSER_NAMES = new Set([
  'chrome',
  'chromium',
  'google-chrome',
  'msedge',
  'edge',
  'microsoft-edge',
  'brave',
  'firefox',
]);

const BROWSER_PREFIX =
  /^(chrome|chromium|google-chrome|msedge|microsoft-edge|edge|brave|firefox)[/+:|_-]+/i;

const IQIYI = {
  id: 'iqiyi',
  name: '爱奇艺',
  hosts: ['iqiyi.com'],
  domestic: true,
  recordFirst: ['phone', 'username', 'loginMethod'],
  membershipUrl: 'https://www.iqiyi.com/vip/',
  membershipUrls: ['https://www.iqiyi.com/vip/', 'https://vip.iqiyi.com/'],
  // vip.iqiyi.com/ is a 302 back to www.iqiyi.com/vip/. The helpdesk stays.
  cancelUrl: IQIYI_CANCEL_URL,
};

const SITES = [IQIYI];

function primaryHost(site) {
  return site?.hosts?.[0] || '';
}

export function stripBrowserFromHost(value) {
  return String(value || '')
    .trim()
    .replace(BROWSER_PREFIX, '');
}

export function listKnownSites() {
  return SITES.map((site) => ({ ...site }));
}

export function hostFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    if (!hostname || BROWSER_NAMES.has(hostname)) return '';
    return hostname;
  } catch {
    return '';
  }
}

// Site key is the catalog primary host for known sites, or the www-stripped
// lowercase hostname otherwise. Browser name never enters the key.
export function siteKeyFromHost(host) {
  let clean = stripBrowserFromHost(host)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();
  if (!clean || BROWSER_NAMES.has(clean)) return '';
  const known = SITES.find((site) =>
    site.hosts.some((suffix) => clean === suffix || clean.endsWith(`.${suffix}`)),
  );
  return known ? primaryHost(known) : clean;
}

export function siteKeyFromUrl(url) {
  return siteKeyFromHost(hostFromUrl(url));
}

// Accepts a host, URL, or already-normalized key. extra.browser is ignored.
export function siteKeyFromInput(value, extra = {}) {
  void extra.browser;
  const raw = stripBrowserFromHost(value || extra.url || extra.host || extra.siteKey || '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.includes('/')) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    const fromUrl = siteKeyFromUrl(url);
    if (fromUrl) return fromUrl;
  }
  return siteKeyFromHost(raw);
}

export function sameSite(left, right) {
  const a = siteKeyFromInput(left);
  const b = siteKeyFromInput(right);
  return Boolean(a && a === b);
}

export function findSiteByHost(host) {
  const key = siteKeyFromHost(host);
  return SITES.find((site) => primaryHost(site) === key) || null;
}

export function findSiteByUrl(url) {
  return findSiteByHost(hostFromUrl(url));
}

function describeKnown(siteKey, host, known) {
  const key = siteKey || '';
  return {
    siteKey: key,
    host: host || key,
    hosts: known?.hosts || (key ? [key] : []),
    id: known?.id || null,
    name: known?.name || host || key,
    domestic: Boolean(known?.domestic),
    recordFirst: known?.recordFirst || ['phone', 'username', 'loginMethod'],
    membershipUrl: known?.membershipUrl || null,
    membershipUrls: known?.membershipUrls || (known?.membershipUrl ? [known.membershipUrl] : []),
    cancelUrl: known?.cancelUrl || null,
  };
}

export function describeSiteKey(siteKey) {
  const key = siteKeyFromInput(siteKey);
  const known = key ? SITES.find((site) => primaryHost(site) === key) : null;
  return describeKnown(key, key, known);
}

export function describeSite(url) {
  const host = hostFromUrl(url);
  const known = findSiteByHost(host);
  const siteKey = siteKeyFromHost(host);
  return describeKnown(siteKey, host, known);
}

export function hostBelongsToSite(hostname, site) {
  if (!hostname || !site) return false;
  const host = siteKeyFromHost(hostname) || String(hostname).replace(/^www\./, '').toLowerCase();
  const suffixes = [site.siteKey, ...(site.hosts || [])]
    .filter(Boolean)
    .map((value) => siteKeyFromHost(value) || String(value).replace(/^www\./, '').toLowerCase());
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// QR / 扫码 is a login method only. It is never a secret type.
export function normalizeLoginMethod(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (/扫码|二维码|^qr$|^qrcode$/.test(lower)) return LOGIN_METHODS.qr;
  if (/短信|验证码|手机|电话|^phone$|^sms$|^mobile$/.test(lower)) return LOGIN_METHODS.phone;
  if (/用户名|账号|帐号|邮箱|密码登录|账号登录|^username$|^email$|^account$/.test(lower)) {
    return LOGIN_METHODS.username;
  }
  return raw;
}

export function isQrLogin(value) {
  return normalizeLoginMethod(value) === LOGIN_METHODS.qr;
}

export function displayLoginMethod(value) {
  if (!value) return '';
  return isQrLogin(value) ? '扫码' : String(value);
}

export function resolveOpenInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  if (lowered === 'iqiyi' || raw === '爱奇艺') {
    return { url: IQIYI.membershipUrl, site: IQIYI };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, site: findSiteByUrl(raw) };
  }

  if (raw.includes('.') && !raw.includes(' ')) {
    const url = `https://${raw.replace(/^\/+/, '')}`;
    return { url, site: findSiteByUrl(url) };
  }

  return null;
}

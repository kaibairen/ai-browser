export const IQIYI_CANCEL_URL = 'https://vip.iqiyi.com/viphelpdesk.html';

const IQIYI = {
  id: 'iqiyi',
  name: '爱奇艺',
  hosts: ['iqiyi.com'],
  membershipUrl: 'https://www.iqiyi.com/vip/',
  membershipUrls: ['https://www.iqiyi.com/vip/', 'https://vip.iqiyi.com/'],
  // vip.iqiyi.com/ is a 302 back to www.iqiyi.com/vip/. The helpdesk stays.
  cancelUrl: IQIYI_CANCEL_URL,
};

const SITES = [IQIYI];

export function listKnownSites() {
  return SITES.map((site) => ({ ...site }));
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function siteKeyFromHost(host) {
  const clean = String(host || '')
    .replace(/^www\./, '')
    .toLowerCase();
  if (!clean) return '';
  const known = SITES.find((site) =>
    site.hosts.some((suffix) => clean === suffix || clean.endsWith(`.${suffix}`)),
  );
  return known ? known.hosts[0] : clean;
}

export function findSiteByHost(host) {
  const key = siteKeyFromHost(host);
  return SITES.find((site) => site.hosts.includes(key)) || null;
}

export function findSiteByUrl(url) {
  return findSiteByHost(hostFromUrl(url));
}

export function describeSiteKey(siteKey) {
  const known = SITES.find((site) => site.hosts.includes(siteKey));
  return {
    siteKey,
    host: siteKey,
    hosts: known?.hosts || [siteKey],
    id: known?.id || null,
    name: known?.name || siteKey,
    membershipUrl: known?.membershipUrl || null,
    membershipUrls: known?.membershipUrls || (known?.membershipUrl ? [known.membershipUrl] : []),
    cancelUrl: known?.cancelUrl || null,
  };
}

export function describeSite(url) {
  const host = hostFromUrl(url);
  const known = findSiteByHost(host);
  const siteKey = siteKeyFromHost(host);
  return {
    siteKey,
    host,
    hosts: known?.hosts || (siteKey ? [siteKey] : []),
    id: known?.id || null,
    name: known?.name || host,
    membershipUrl: known?.membershipUrl || null,
    membershipUrls: known?.membershipUrls || (known?.membershipUrl ? [known.membershipUrl] : []),
    cancelUrl: known?.cancelUrl || null,
  };
}

export function hostBelongsToSite(hostname, site) {
  if (!hostname || !site) return false;
  const host = String(hostname)
    .replace(/^www\./, '')
    .toLowerCase();
  const suffixes = [site.siteKey, ...(site.hosts || [])]
    .filter(Boolean)
    .map((value) => String(value).replace(/^www\./, '').toLowerCase());
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
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

import { hostBelongsToSite, normalizeLoginMethod } from '../sites/catalog.js';

export const NEAR_EXPIRY_DAYS = 7;

export function daysUntil(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const end = new Date(`${expiresAt}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

export function isNearExpiry(expiresAt, now = new Date()) {
  const days = daysUntil(expiresAt, now);
  return days !== null && days >= 0 && days <= NEAR_EXPIRY_DAYS;
}

export function shouldMentionExpiry(record, now = new Date()) {
  if (!record?.expiresAt) return false;
  if (!isNearExpiry(record.expiresAt, now)) return false;
  return record.expiryMentionedFor !== record.expiresAt;
}

export function isMembershipPage(site, url) {
  if (!site?.siteKey || !url) return false;
  let current;
  try {
    current = new URL(url);
  } catch {
    return false;
  }

  const host = current.hostname.toLowerCase();
  if (!hostBelongsToSite(host, site)) return false;

  if (host.split('.')[0] === 'vip') return true;
  if (/\/vip(\/|$)/i.test(current.pathname)) return true;

  for (const candidate of [site.membershipUrl, ...(site.membershipUrls || [])]) {
    if (!candidate) continue;
    try {
      const membership = new URL(candidate);
      if (!hostBelongsToSite(membership.hostname, site)) continue;
      const currentPath = current.pathname.replace(/\/$/, '') || '/';
      const membershipPath = membership.pathname.replace(/\/$/, '') || '/';
      if (membershipPath !== '/' && (currentPath === membershipPath || currentPath.startsWith(`${membershipPath}/`))) {
        return true;
      }
    } catch {
      // Ignore malformed catalog URLs.
    }
  }
  return false;
}

export function expiryMention(record, site) {
  if (!record || !site) return null;
  return {
    siteKey: site.siteKey,
    siteName: site.name,
    expiresAt: record.expiresAt,
    cancelUrl: site.cancelUrl,
    text: `${site.name}会员将于 ${record.expiresAt} 到期`,
  };
}

// Current-page observation wins for loginMethod. A stored phone method
// must not appear on the confirm card when the live page is 扫码.
export function saveProposalFields(snapshot, record) {
  return {
    phone: snapshot?.phone || record?.phone || '',
    username: snapshot?.username || record?.username || '',
    loginMethod: normalizeLoginMethod(snapshot?.loginMethod || ''),
    expiresAt: snapshot?.expiresAt || record?.expiresAt || '',
    passwordPresent: Boolean(snapshot?.passwordPresent),
  };
}

export function createSessionPolicy() {
  const dismissedSave = new Set();
  const dismissedFill = new Set();
  let snapshot = null;
  let liveMention = null;

  return {
    setSnapshot(next) {
      snapshot = next;
    },

    getSnapshot() {
      return snapshot;
    },

    dismissSave(siteKey) {
      if (siteKey) dismissedSave.add(siteKey);
    },

    dismissFill(siteKey) {
      if (siteKey) dismissedFill.add(siteKey);
    },

    consumeMention() {
      const mention = liveMention;
      liveMention = null;
      return mention;
    },

    peekMention() {
      return liveMention;
    },

    // Rail stays silent unless there is a confirm prompt or one expiry mention.
    surface({ site, record, records = [], url, now }) {
      if (!liveMention) {
        const due = [{ site, record }, ...records].find(
          (item) => item.record && shouldMentionExpiry(item.record, now),
        );
        if (due) liveMention = expiryMention(due.record, due.site);
      }

      const mention = liveMention;
      const extracted =
        snapshot &&
        snapshot.siteKey === site?.siteKey &&
        (snapshot.phone ||
          snapshot.username ||
          snapshot.expiresAt ||
          snapshot.loginForm ||
          snapshot.loginMethod);
      const differs =
        record &&
        extracted &&
        ((snapshot.phone && snapshot.phone !== record.phone) ||
          (snapshot.username && snapshot.username !== record.username) ||
          (snapshot.expiresAt && snapshot.expiresAt !== record.expiresAt) ||
          (snapshot.loginMethod && snapshot.loginMethod !== record.loginMethod));
      const save =
        site?.siteKey &&
        !dismissedSave.has(site.siteKey) &&
        ((!record && (extracted || isMembershipPage(site, url))) || differs)
          ? {
              kind: 'save',
              siteKey: site.siteKey,
              siteName: site.name,
              ...saveProposalFields(snapshot, record),
            }
          : null;

      const fill =
        record &&
        site?.siteKey &&
        !dismissedFill.has(site.siteKey) &&
        (snapshot?.loginForm ||
          record.passwordStored ||
          isMembershipPage(site, url))
          ? {
              kind: 'fill',
              siteKey: site.siteKey,
              siteName: site.name,
              phone: record.phone,
              username: record.username,
              loginMethod: record.loginMethod,
              passwordStored: record.passwordStored,
            }
          : null;

      if (save) {
        return { silent: false, proposal: save, mention };
      }
      if (fill) {
        return { silent: false, proposal: fill, mention };
      }
      if (mention) {
        return { silent: false, proposal: null, mention };
      }
      return { silent: true, proposal: null, mention: null };
    },
  };
}

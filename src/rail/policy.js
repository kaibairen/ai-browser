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
  if (!site?.membershipUrl || !url) return false;
  try {
    return new URL(url).origin === new URL(site.membershipUrl).origin;
  } catch {
    return false;
  }
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
        (snapshot.phone || snapshot.username || snapshot.expiresAt || snapshot.loginForm);
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
              phone: snapshot?.phone || record?.phone || '',
              username: snapshot?.username || record?.username || '',
              loginMethod: snapshot?.loginMethod || record?.loginMethod || '',
              expiresAt: snapshot?.expiresAt || record?.expiresAt || '',
              passwordPresent: Boolean(snapshot?.passwordPresent),
            }
          : null;

      const fill =
        record &&
        snapshot &&
        snapshot.siteKey === site?.siteKey &&
        !dismissedFill.has(site?.siteKey) &&
        snapshot.loginForm
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

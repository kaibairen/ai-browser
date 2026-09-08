import { locateEngineBinary } from './engine/locate.js';
import { launchEngine, launchRailWindow } from './engine/launch.js';
import { attachEngine, isCdpDisconnect, originsMatch } from './engine/cdp.js';
import { detectScreen } from './engine/screen.js';
import { createSiteStore } from './store/site-store.js';
import { createSessionPolicy } from './rail/policy.js';
import { startRailServer } from './rail/server.js';
import { describeSite, describeSiteKey, resolveOpenInput } from './sites/catalog.js';
import { clickPath } from './trace.js';

function httpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // Ignore non-URLs.
  }
  return '';
}

export async function startWorkspace() {
  const store = createSiteStore();
  await store.load();

  const policy = createSessionPolicy();
  const located = await locateEngineBinary();

  let engine = null;
  let engineUrl = 'about:blank';
  let engineStatus = 'starting';
  let launched = null;
  let lastSelectors = {};
  let pendingPassword = '';
  let snapTimer = null;
  let railWindow = null;
  let railRestarts = 0;
  let openCancelInFlight = null;
  let screen = await detectScreen();
  let versionMisses = 0;

  const currentSite = () => describeSite(engineUrl);

  const getState = () => {
    const site = currentSite();
    const record = store.get(site.siteKey);
    const records = store.list().map((row) => ({
      site: describeSiteKey(row.siteKey),
      record: row,
    }));
    const surface = policy.surface({ site, record, records, url: engineUrl });
    return {
      engine: {
        status: engineStatus,
        url: engineUrl,
        site: site.name || '',
      },
      ...surface,
    };
  };

  const rail = startRailServer({
    getState,
    actions: {
      async open(input) {
        const resolved = resolveOpenInput(input);
        if (!resolved) {
          return { ok: false, error: '需要网址，或爱奇艺这样的已知站点' };
        }
        try {
          const opened = await openInEngine(resolved.url);
          return { ok: true, url: opened };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },

      async confirmSave(fields) {
        const site = currentSite();
        if (!site.siteKey) return { ok: false, error: '当前页没有站点键' };
        const typed = typeof fields.password === 'string' ? fields.password : '';
        await store.confirmWrite(
          site.siteKey,
          {
            phone: fields.phone || '',
            username: fields.username || '',
            loginMethod: fields.loginMethod || '',
            expiresAt: fields.expiresAt || '',
            savePassword: typed.length > 0,
          },
          typed,
        );
        policy.dismissSave(site.siteKey);
        policy.setSnapshot(null);
        pendingPassword = '';
        await publish();
        return { ok: true, record: store.bubbleView(site.siteKey) };
      },

      async dismissSave() {
        policy.dismissSave(currentSite().siteKey);
        await publish();
        return { ok: true };
      },

      async confirmFill(fields = {}) {
        const site = currentSite();
        const record = store.get(site.siteKey);
        if (!record) return { ok: false, error: '没有可填写的已确认身份' };
        const typed = typeof fields.password === 'string' ? fields.password : '';
        const password = typed || store.takePasswordForFill(site.siteKey);
        await ensureEngine();
        await engine.fill(lastSelectors, {
          phone: record.phone,
          username: record.username,
          password,
        });
        policy.dismissFill(site.siteKey);
        await engine.focusEngine();
        await publish();
        return { ok: true, filled: true, submitted: false };
      },

      async dismissFill() {
        policy.dismissFill(currentSite().siteKey);
        await publish();
        return { ok: true };
      },

      async openCancel(body = {}) {
        const mention = policy.peekMention();
        const cancelUrl =
          httpUrl(body.url) || httpUrl(mention?.cancelUrl) || 'https://vip.iqiyi.com/';
        const received = {
          bodyUrl: body.url || '',
          mentionUrl: mention?.cancelUrl || '',
          cancelUrl,
          engineUrl,
          engineStatus,
          connected: Boolean(engine?.connected),
        };
        if (openCancelInFlight) {
          clickPath('open-cancel-join', received);
          return openCancelInFlight;
        }
        openCancelInFlight = (async () => {
          await clickPath('open-cancel-received', received);
          try {
            const opened = await openInEngine(cancelUrl);
            await clickPath('open-cancel-reached', { cancelUrl, opened });
            if (!originsMatch(cancelUrl, opened)) {
              await publish();
              return { ok: false, error: `引擎仍在 ${opened}`, url: opened };
            }
            policy.consumeMention();
            if (mention?.siteKey && mention.expiresAt) {
              await store.markExpiryMentioned(mention.siteKey, mention.expiresAt);
            }
            await publish();
            return { ok: true, url: opened };
          } catch (error) {
            await clickPath('open-cancel-failed', {
              cancelUrl,
              error: error.message,
              engineUrl,
            });
            await publish();
            return { ok: false, error: error.message, url: engineUrl };
          } finally {
            openCancelInFlight = null;
          }
        })();
        return openCancelInFlight;
      },

      async dismissMention() {
        const mention = policy.consumeMention();
        if (mention?.siteKey && mention.expiresAt) {
          await store.markExpiryMentioned(mention.siteKey, mention.expiresAt);
        }
        await publish();
        return { ok: true };
      },
    },
  });

  function markNotOpen() {
    engineStatus = 'not-open';
    engine = null;
    policy.setSnapshot(null);
    pendingPassword = '';
    publish().catch(() => {});
  }

  async function publish() {
    const state = getState();
    const mention = state.mention || policy.peekMention();
    if (mention?.siteKey && mention.expiresAt) {
      const record = store.get(mention.siteKey);
      if (record && record.expiryMentionedFor !== mention.expiresAt) {
        await store.markExpiryMentioned(mention.siteKey, mention.expiresAt);
      }
    }
    rail.push();
    return state;
  }

  async function refreshSnapshot() {
    if (!engine?.connected) return;
    try {
      const snap = await engine.snapshot();
      if (!snap) return;
      const site = describeSite(snap.href || engineUrl);
      if (snap.href) engineUrl = snap.href;
      lastSelectors = snap.fields || {};
      pendingPassword = snap.passwordValue || '';
      policy.setSnapshot({
        siteKey: site.siteKey,
        phone: snap.phone,
        username: snap.username,
        loginMethod: snap.loginMethod,
        expiresAt: snap.expiresAt,
        passwordPresent: Boolean(snap.passwordPresent),
        loginForm: Boolean(snap.loginForm),
      });
      await publish();
    } catch (error) {
      if (isCdpDisconnect(error)) markNotOpen();
    }
  }

  function bindEngine(next) {
    engine = next;
    engineStatus = next.connected ? 'running' : 'not-open';
    versionMisses = 0;
    return next;
  }

  async function connectEngine(port, startUrl) {
    const attached = await attachEngine(port, {
      onNavigate(url) {
        if (!url || url === engineUrl) return;
        engineUrl = url;
        policy.setSnapshot(null);
        pendingPassword = '';
        publish().catch(() => {});
        refreshSnapshot().catch((error) => {
          if (isCdpDisconnect(error)) markNotOpen();
        });
      },
      onLoad() {
        refreshSnapshot().catch((error) => {
          if (isCdpDisconnect(error)) markNotOpen();
        });
      },
      onAction() {
        clearTimeout(snapTimer);
        snapTimer = setTimeout(() => {
          refreshSnapshot().catch((error) => {
            if (isCdpDisconnect(error)) markNotOpen();
          });
        }, 400);
      },
      onDisconnect() {
        markNotOpen();
      },
    });
    bindEngine(attached);
    if (startUrl) engineUrl = startUrl;
    try {
      screen = await attached.layoutLeftOfRail(screen);
    } catch (error) {
      if (isCdpDisconnect(error)) markNotOpen();
    }
    return attached;
  }

  async function relaunchEngine(startUrl) {
    if (engine) {
      try {
        await engine.close();
      } catch {
        // Previous session already gone.
      }
    }
    launched = await launchEngine(located.binary, startUrl || 'about:blank');
    engineUrl = startUrl || 'about:blank';
    engineStatus = 'starting';
    await connectEngine(launched.port, engineUrl);
    if (engine?.connected) await engine.focusEngine();
  }

  async function ensureEngine(startUrl) {
    if (engine?.connected && engineStatus !== 'not-open') return;
    await relaunchEngine(startUrl || engineUrl || 'about:blank');
  }

  async function openInEngine(url) {
    const hintUrl = engineUrl;
    try {
      if (!engine?.connected || engineStatus === 'not-open') {
        await relaunchEngine(url);
        const opened = await engine.waitForOrigin(url, 10000);
        if (!originsMatch(url, opened)) {
          const reached = await engine.navigateAndWait(url, 10000, hintUrl);
          engineUrl = reached;
        } else {
          engineUrl = opened;
        }
      } else {
        engineUrl = await engine.navigateAndWait(url, 10000, hintUrl);
        await engine.focusEngine();
      }
    } catch (error) {
      if (!isCdpDisconnect(error)) throw error;
      markNotOpen();
      await relaunchEngine(url);
      engineUrl = await engine.navigateAndWait(url, 10000, hintUrl);
    }
    if (!originsMatch(url, engineUrl)) {
      throw new Error(`engine stayed on ${engineUrl}`);
    }
    await publish();
    return engineUrl;
  }

  async function ensureRail() {
    if (railRestarts > 8) return;
    railWindow = await launchRailWindow(located.binary, railUrl, screen);
    railWindow.child?.on('exit', () => {
      railRestarts += 1;
      setTimeout(() => {
        ensureRail().catch(() => {});
      }, 600);
    });
  }

  const railPort = await rail.listen();
  const railUrl = `http://127.0.0.1:${railPort}/`;

  launched = await launchEngine(located.binary, 'about:blank');
  try {
    await connectEngine(launched.port, 'about:blank');
  } catch (error) {
    if (!isCdpDisconnect(error)) throw error;
    markNotOpen();
  }
  await ensureRail();
  if (engine?.connected) await engine.focusEngine();
  await publish();

  setInterval(() => {
    if (engineStatus === 'not-open' || !launched?.port) {
      versionMisses = 0;
      return;
    }
    fetch(`http://127.0.0.1:${launched.port}/json/version`)
      .then((response) => {
        if (response.ok) versionMisses = 0;
        else {
          versionMisses += 1;
          if (versionMisses >= 3) markNotOpen();
        }
      })
      .catch(() => {
        versionMisses += 1;
        if (versionMisses >= 3) markNotOpen();
      });
  }, 2000);

  const shutdown = async () => {
    clearTimeout(snapTimer);
    await engine?.close();
    rail.close();
    for (const pid of [railWindow?.pid, launched?.pid]) {
      if (pid) {
        try {
          process.kill(pid);
        } catch {
          // Window already gone.
        }
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { railUrl, enginePort: launched.port, engineKind: located.kind };
}

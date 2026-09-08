import { locateEngineBinary } from './engine/locate.js';
import { launchEngine, launchRailWindow } from './engine/launch.js';
import { attachEngine } from './engine/cdp.js';
import { createSiteStore } from './store/site-store.js';
import { createSessionPolicy } from './rail/policy.js';
import { startRailServer } from './rail/server.js';
import { describeSite, describeSiteKey, resolveOpenInput } from './sites/catalog.js';

export async function startWorkspace() {
  const store = createSiteStore();
  await store.load();

  const policy = createSessionPolicy();
  const located = await locateEngineBinary();

  let engine = null;
  let engineUrl = 'about:blank';
  let engineStatus = 'starting';
  let lastSelectors = {};
  let pendingPassword = '';
  let snapTimer = null;

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
        if (!engine) return { ok: false, error: '引擎尚未打开' };
        await engine.navigate(resolved.url);
        await engine.focusEngine();
        return { ok: true, url: resolved.url };
      },

      async confirmSave(fields) {
        const site = currentSite();
        if (!site.siteKey) return { ok: false, error: '当前页没有站点键' };
        const snapshot = policy.getSnapshot();
        const password =
          fields.savePassword && snapshot?.passwordPresent ? pendingPassword : '';
        await store.confirmWrite(
          site.siteKey,
          {
            phone: fields.phone || '',
            username: fields.username || '',
            loginMethod: fields.loginMethod || '',
            expiresAt: fields.expiresAt || '',
            savePassword: Boolean(fields.savePassword && password),
          },
          password,
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

      async confirmFill() {
        const site = currentSite();
        const record = store.get(site.siteKey);
        if (!record || !engine) return { ok: false, error: '没有可填写的已确认身份' };
        const password = store.takePasswordForFill(site.siteKey);
        await engine.fill(lastSelectors, {
          phone: record.phone,
          username: record.username,
          password,
        });
        policy.dismissFill(site.siteKey);
        await engine.focusEngine();
        await publish();
        return { ok: true };
      },

      async dismissFill() {
        policy.dismissFill(currentSite().siteKey);
        await publish();
        return { ok: true };
      },

      async openCancel() {
        const mention = policy.consumeMention();
        if (!mention?.cancelUrl || !engine) {
          await publish();
          return { ok: false, error: '没有可打开的取消页' };
        }
        if (mention.siteKey && mention.expiresAt) {
          await store.markExpiryMentioned(mention.siteKey, mention.expiresAt);
        }
        await engine.navigate(mention.cancelUrl);
        await engine.focusEngine();
        await publish();
        return { ok: true, url: mention.cancelUrl };
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
    if (!engine) return;
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
  }

  const railPort = await rail.listen();
  const railUrl = `http://127.0.0.1:${railPort}/`;
  const railWindow = await launchRailWindow(located.binary, railUrl);

  const launched = await launchEngine(located.binary);
  engineStatus = 'running';
  engine = await attachEngine(launched.port, {
    onNavigate(url) {
      engineUrl = url;
      policy.setSnapshot(null);
      pendingPassword = '';
      publish();
      refreshSnapshot();
    },
    onLoad() {
      refreshSnapshot().catch(() => {});
    },
    onAction() {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        refreshSnapshot().catch(() => {});
      }, 400);
    },
  });
  await engine.focusEngine();
  await publish();

  const shutdown = async () => {
    clearTimeout(snapTimer);
    await engine?.close();
    rail.close();
    for (const pid of [railWindow.pid, launched.pid]) {
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

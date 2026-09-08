import CDP from 'chrome-remote-interface';
import { engineBounds } from './screen.js';
import { FILL_SOURCE, OBSERVER_SOURCE, SNAPSHOT_SOURCE } from './observer.js';

const HIDDEN_PREFIXES = ['devtools://', 'chrome://', 'chrome-extension://', 'edge://'];

export function isCdpDisconnect(error) {
  const message = String(error?.message || error || '');
  return /WebSocket connection closed|WebSocket is not open|socket hang up|ECONNRESET|ECONNREFUSED|not opened|closed before the connection/i.test(
    message,
  );
}

function isUsablePage(info) {
  if (!info || info.type !== 'page') return false;
  const url = info.url || '';
  return !HIDDEN_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function hostsMatch(expected, current) {
  try {
    const want = new URL(expected);
    const got = new URL(current);
    const strip = (host) => host.replace(/^www\./, '').toLowerCase();
    const a = strip(want.hostname);
    const b = strip(got.hostname);
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return Boolean(current) && current.includes(expected);
  }
}

async function connectBrowser(port) {
  const version = await CDP.Version({ host: '127.0.0.1', port });
  return CDP({
    host: '127.0.0.1',
    port,
    target: version.webSocketDebuggerUrl,
  });
}

export async function placeWindow(port, bounds) {
  const browser = await connectBrowser(port);
  try {
    const { targetInfos } = await browser.Target.getTargets();
    const page = targetInfos.find((info) => info.type === 'page');
    if (!page) return;
    const { windowId } = await browser.Browser.getWindowForTarget({
      targetId: page.targetId,
    });
    await browser.Browser.setWindowBounds({
      windowId,
      bounds: { windowState: 'normal' },
    });
    await browser.Browser.setWindowBounds({
      windowId,
      bounds: { ...bounds, windowState: 'normal' },
    });
  } finally {
    try {
      await browser.close();
    } catch {
      // Placement connection is disposable.
    }
  }
}

export async function attachEngine(port, handlers) {
  let browser;
  try {
    browser = await connectBrowser(port);
  } catch (error) {
    if (!isCdpDisconnect(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    browser = await connectBrowser(port);
  }

  let closed = false;
  let pageSessionId = null;
  let pageTargetId = null;

  const handleDisconnect = () => {
    if (closed) return;
    closed = true;
    pageSessionId = null;
    pageTargetId = null;
    handlers.onDisconnect?.();
  };

  browser.on('disconnect', handleDisconnect);
  browser.on('error', (error) => {
    if (isCdpDisconnect(error)) handleDisconnect();
  });

  const { Target, Browser } = browser;
  await Target.setDiscoverTargets({ discover: true });
  await Target.setAutoAttach({
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false,
  });

  async function listPages() {
    const { targetInfos } = await Target.getTargets();
    return targetInfos.filter(isUsablePage);
  }

  async function prepareSession(sessionId, targetId) {
    pageSessionId = sessionId;
    pageTargetId = targetId;
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    try {
      await browser.send('Runtime.addBinding', { name: 'aiBrowserReport' }, sessionId);
    } catch {
      // Binding may already exist on this session.
    }
    await browser.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: OBSERVER_SOURCE },
      sessionId,
    );
    try {
      await browser.send(
        'Runtime.evaluate',
        { expression: OBSERVER_SOURCE, returnByValue: true },
        sessionId,
      );
    } catch {
      // Document may still be loading.
    }
  }

  async function ensurePageSession() {
    if (closed) throw new Error('WebSocket connection closed');
    if (pageSessionId) return pageSessionId;
    const pages = await listPages();
    let page = pages[0];
    if (!page) {
      const created = await Target.createTarget({ url: 'about:blank' });
      page = { targetId: created.targetId };
    }
    const attached = await Target.attachToTarget({
      targetId: page.targetId,
      flatten: true,
    });
    await prepareSession(attached.sessionId, page.targetId);
    return pageSessionId;
  }

  async function sendToPage(method, params = {}) {
    const sessionId = await ensurePageSession();
    return browser.send(method, params, sessionId);
  }

  browser.on('Target.attachedToTarget', async (params) => {
    try {
      if (params.waitingForDebugger) {
        await browser.send('Runtime.runIfWaitingForDebugger', {}, params.sessionId);
      }
      if (isUsablePage(params.targetInfo) && (!pageSessionId || params.targetInfo.targetId === pageTargetId)) {
        await prepareSession(params.sessionId, params.targetInfo.targetId);
      }
    } catch (error) {
      if (isCdpDisconnect(error)) handleDisconnect();
    }
  });

  browser.on('Target.detachedFromTarget', (params) => {
    if (params.sessionId === pageSessionId) pageSessionId = null;
  });

  browser.on('Target.targetDestroyed', (params) => {
    if (params.targetId === pageTargetId) {
      pageSessionId = null;
      pageTargetId = null;
    }
  });

  browser.on('Target.targetInfoChanged', (params) => {
    const info = params.targetInfo;
    if (!isUsablePage(info) || !info.url) return;
    if (pageTargetId && info.targetId !== pageTargetId) return;
    if (!/^https?:/.test(info.url) && info.url !== 'about:blank') return;
    handlers.onNavigate?.(info.url);
  });

  browser.on('Page.frameNavigated', (params) => {
    if (params.frame?.url && !params.frame.parentId) {
      handlers.onNavigate?.(params.frame.url);
    }
  });

  browser.on('Page.loadEventFired', () => {
    handlers.onLoad?.();
  });

  browser.on('Runtime.bindingCalled', (params) => {
    if (params.name !== 'aiBrowserReport') return;
    try {
      handlers.onAction?.(JSON.parse(params.payload));
    } catch {
      // Ignore malformed observer payloads.
    }
  });

  try {
    await ensurePageSession();
  } catch (error) {
    if (!isCdpDisconnect(error)) throw error;
    handleDisconnect();
  }

  return {
    get connected() {
      return !closed;
    },
    async layoutLeftOfRail(screen) {
      if (closed || !pageTargetId) return screen;
      const { windowId, bounds } = await Browser.getWindowForTarget({
        targetId: pageTargetId,
      });
      const next = engineBounds(screen);
      if (bounds.windowState && bounds.windowState !== 'normal') {
        await Browser.setWindowBounds({
          windowId,
          bounds: { windowState: 'normal' },
        });
      }
      await Browser.setWindowBounds({
        windowId,
        bounds: { ...next, windowState: 'normal' },
      });
      return screen;
    },
    async navigate(url) {
      try {
        await sendToPage('Page.navigate', { url });
      } catch (error) {
        if (!isCdpDisconnect(error) && pageSessionId) throw error;
        pageSessionId = null;
        if (closed) throw error;
        const created = await Target.createTarget({ url });
        const attached = await Target.attachToTarget({
          targetId: created.targetId,
          flatten: true,
        });
        await prepareSession(attached.sessionId, created.targetId);
      }
    },
    async navigateAndWait(url, timeoutMs = 8000) {
      await this.navigate(url);
      const deadline = Date.now() + timeoutMs;
      let last = '';
      while (Date.now() < deadline) {
        if (closed) throw new Error('WebSocket connection closed');
        try {
          last = await this.currentUrl();
          if (last && hostsMatch(url, last)) return last;
        } catch (error) {
          if (isCdpDisconnect(error)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return last || url;
    },
    async currentUrl() {
      const { frameTree } = await sendToPage('Page.getFrameTree');
      return frameTree?.frame?.url || '';
    },
    async snapshot() {
      const { result } = await sendToPage('Runtime.evaluate', {
        expression: SNAPSHOT_SOURCE,
        returnByValue: true,
      });
      return result?.value || null;
    },
    async fill(selectors, values) {
      const { result } = await sendToPage('Runtime.evaluate', {
        expression: `(${FILL_SOURCE})(${JSON.stringify(selectors || {})}, ${JSON.stringify(values || {})})`,
        returnByValue: true,
      });
      return result?.value || [];
    },
    async focusEngine() {
      try {
        await sendToPage('Page.bringToFront');
      } catch {
        // Focusing the engine is best-effort; the rail must never steal it.
      }
    },
    async close() {
      closed = true;
      try {
        await browser.close();
      } catch {
        // Already disconnected.
      }
    },
  };
}

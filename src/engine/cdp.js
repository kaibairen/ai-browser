import CDP from 'chrome-remote-interface';
import { engineBounds, engineBoundsLeftOf, fitOuterBounds, RAIL_GAP } from './screen.js';
import { FILL_SOURCE, mergeObservationSnapshots, OBSERVER_SOURCE, SNAPSHOT_SOURCE } from './observer.js';
import { clickPath } from '../trace.js';

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

export function originsMatch(expected, current) {
  try {
    return new URL(expected).origin === new URL(current).origin;
  } catch {
    return false;
  }
}

export function reachedExpectedPage(expected, current) {
  const want = safeUrl(expected);
  const got = safeUrl(current);
  if (!want || !got) return false;
  if (got.href.split('#')[0] === want.href.split('#')[0]) return true;
  if (got.origin !== want.origin) return false;
  const wantPath = want.pathname.replace(/\/+$/, '') || '/';
  const gotPath = got.pathname.replace(/\/+$/, '') || '/';
  if (wantPath !== '/' && gotPath !== wantPath && !gotPath.startsWith(`${wantPath}/`)) {
    return false;
  }
  return true;
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function flattenFrames(tree, acc = []) {
  if (!tree?.frame) return acc;
  acc.push(tree.frame);
  for (const child of tree.childFrames || []) flattenFrames(child, acc);
  return acc;
}

export function pickTopPage(pages, hintUrl, currentTargetId) {
  const usable = (pages || []).filter(isUsablePage);
  if (!usable.length) return null;
  const httpPages = usable.filter((page) => /^https?:/i.test(page.url || ''));
  const pool = httpPages.length ? httpPages : usable;
  const hint = safeUrl(hintUrl);
  let best = null;
  let bestScore = -1;
  for (const page of pool) {
    let score = 0;
    const url = page.url || '';
    if (page.targetId && page.targetId === currentTargetId) score += 30;
    const current = safeUrl(url);
    if (current) {
      if (current.protocol === 'https:') score += 8;
      if (current.protocol === 'http:') score += 6;
      if (hint) {
        if (current.href.split('#')[0] === hint.href.split('#')[0]) score += 200;
        if (current.origin === hint.origin) score += 120;
        if (current.hostname === hint.hostname) score += 40;
        const hintHost = hint.hostname.replace(/^www\./, '');
        const curHost = current.hostname.replace(/^www\./, '');
        if (curHost === hintHost || curHost.endsWith(`.${hintHost}`) || hintHost.endsWith(`.${curHost}`)) {
          score += 25;
        }
      }
    } else if (url === 'about:blank') {
      score += 1;
    }
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  return best;
}

async function connectBrowser(port) {
  const version = await CDP.Version({ host: '127.0.0.1', port });
  return CDP({
    host: '127.0.0.1',
    port,
    target: version.webSocketDebuggerUrl,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function placeWindow(port, bounds, screen) {
  const wanted = screen ? fitOuterBounds(bounds, screen) : { ...bounds };
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const browser = await connectBrowser(port);
    try {
      const { targetInfos } = await browser.Target.getTargets();
      const page = targetInfos.find((info) => info.type === 'page');
      if (!page) {
        lastError = new Error('no page target for window placement');
        await sleep(120);
        continue;
      }
      const { windowId } = await browser.Browser.getWindowForTarget({
        targetId: page.targetId,
      });
      await browser.Browser.setWindowBounds({
        windowId,
        bounds: { windowState: 'normal' },
      });
      await browser.Browser.setWindowBounds({
        windowId,
        bounds: {
          left: wanted.left,
          top: wanted.top,
          width: wanted.width,
          height: wanted.height,
          windowState: 'normal',
        },
      });
      const { bounds: actual } = await browser.Browser.getWindowBounds({ windowId });
      if (screen) {
        const width = actual.width || wanted.width;
        const height = actual.height || wanted.height;
        const overflowRight = (actual.left || 0) + width - screen.width;
        const overflowBottom = (actual.top || 0) + height - screen.height;
        if (overflowRight > 2 || overflowBottom > 2 || (actual.left || 0) < 0 || (actual.top || 0) < 0) {
          wanted.left = Math.max(8, Math.min(wanted.left, screen.width - width - 8));
          wanted.top = Math.max(8, Math.min(wanted.top, screen.height - height - 8));
          if (width > screen.width - 16) wanted.width = Math.min(wanted.width, screen.width - 16);
          if (height > screen.height - 16) wanted.height = Math.min(wanted.height, screen.height - 16);
          await sleep(80);
          continue;
        }
      }
      const placed =
        Math.abs((actual.left || 0) - wanted.left) <= 12 &&
        Math.abs((actual.top || 0) - wanted.top) <= 12;
      if (placed || attempt === 7) return actual;
      await sleep(100);
    } catch (error) {
      lastError = error;
      await sleep(120);
    } finally {
      try {
        await browser.close();
      } catch {
        // Placement connection is disposable.
      }
    }
  }

  if (lastError) throw lastError;
  return wanted;
}

export async function getWindowOuterBounds(port) {
  const browser = await connectBrowser(port);
  try {
    const { targetInfos } = await browser.Target.getTargets();
    const page = targetInfos.find((info) => info.type === 'page' || info.type === 'app');
    if (!page) return null;
    const { windowId } = await browser.Browser.getWindowForTarget({
      targetId: page.targetId,
    });
    const { bounds } = await browser.Browser.getWindowBounds({ windowId });
    return { ...bounds, windowId, targetId: page.targetId };
  } finally {
    try {
      await browser.close();
    } catch {
      // Placement connection is disposable.
    }
  }
}

export async function keepSinglePageWindow(port, keepUrl) {
  const browser = await connectBrowser(port);
  try {
    const { targetInfos } = await browser.Target.getTargets();
    const pages = targetInfos.filter((info) => info.type === 'page' || info.type === 'app');
    if (pages.length <= 1) return pages[0] || null;
    const want = keepUrl ? safeUrl(keepUrl) : null;
    const scored = pages.map((page) => {
      const current = safeUrl(page.url);
      let score = 0;
      if (want && current) {
        if (current.href.split('#')[0] === want.href.split('#')[0]) score += 8;
        if (current.origin === want.origin) score += 4;
      }
      if (page.url && page.url !== 'about:blank') score += 1;
      return { page, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const keep = scored[0].page;
    for (const { page } of scored.slice(1)) {
      try {
        await browser.Target.closeTarget({ targetId: page.targetId });
      } catch {
        // Extra hanger may already be gone.
      }
    }
    return keep;
  } finally {
    try {
      await browser.close();
    } catch {
      // Placement connection is disposable.
    }
  }
}

export async function placeEngineBesideRail(enginePort, railPort, screen) {
  let rail = await getWindowOuterBounds(railPort);
  if (!rail || !Number.isFinite(rail.left)) {
    return placeWindow(enginePort, engineBounds(screen), screen);
  }
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    rail = (await getWindowOuterBounds(railPort)) || rail;
    const engine = await getWindowOuterBounds(enginePort);
    if (!engine) break;
    const limit = rail.left - RAIL_GAP;
    const engineRight = (engine.left || 0) + (engine.width || 0);
    last = engine;
    if (engineRight <= limit + 1) return engine;
    const width = Math.max(640, Math.floor(limit - (engine.left || 0)));
    last = await placeWindow(
      enginePort,
      {
        left: engine.left || 0,
        top: engine.top || 0,
        width,
        height: engine.height || engineBounds(screen).height,
      },
      screen,
    );
  }
  return last;
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
    let page = pickTopPage(pages, '', pageTargetId) || pages[0];
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

  async function bindTopPage(hintUrl) {
    if (closed) throw new Error('WebSocket connection closed');
    const pages = await listPages();
    const chosen = pickTopPage(pages, hintUrl, pageTargetId);
    const listed = pages.map((page) => ({
      targetId: page.targetId,
      url: page.url,
      type: page.type,
    }));
    if (!chosen) {
      await ensurePageSession();
      await clickPath('bind-top-page', {
        hintUrl,
        chosenUrl: '',
        targetId: pageTargetId,
        sessionId: pageSessionId,
        listed,
        fallback: 'ensure-empty',
      });
      return {
        sessionId: pageSessionId,
        targetId: pageTargetId,
        url: '',
      };
    }
    const rebound = chosen.targetId !== pageTargetId || !pageSessionId;
    if (rebound) {
      const attached = await Target.attachToTarget({
        targetId: chosen.targetId,
        flatten: true,
      });
      await prepareSession(attached.sessionId, chosen.targetId);
    } else {
      await browser.send('Page.enable', {}, pageSessionId);
      await browser.send('Runtime.enable', {}, pageSessionId);
    }
    try {
      await Target.activateTarget({ targetId: chosen.targetId });
    } catch {
      // Activation is best-effort; navigate still uses this session.
    }
    await clickPath('bind-top-page', {
      hintUrl,
      chosenUrl: chosen.url || '',
      targetId: chosen.targetId,
      sessionId: pageSessionId,
      rebound,
      listed,
    });
    return {
      sessionId: pageSessionId,
      targetId: pageTargetId,
      url: chosen.url || '',
    };
  }

  async function urlOfTarget(targetId) {
    if (pageTargetId === targetId && pageSessionId) {
      try {
        const evaluated = await browser.send(
          'Runtime.evaluate',
          { expression: 'location.href', returnByValue: true },
          pageSessionId,
        );
        if (evaluated?.result?.value) return evaluated.result.value;
      } catch {
        // Session may still be loading.
      }
      try {
        const { frameTree } = await browser.send('Page.getFrameTree', {}, pageSessionId);
        if (frameTree?.frame?.url) return frameTree.frame.url;
      } catch {
        // Fall through to the target list.
      }
    }
    const pages = await listPages();
    return pages.find((info) => info.targetId === targetId)?.url || '';
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
    async layoutLeftOfRail(screen, railLeft) {
      if (closed || !pageTargetId) return screen;
      const { windowId, bounds } = await Browser.getWindowForTarget({
        targetId: pageTargetId,
      });
      const next = engineBoundsLeftOf(screen, railLeft);
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
    async navigate(url, hintUrl) {
      const bound = await bindTopPage(hintUrl || '');
      let navigateResult = null;
      try {
        navigateResult = await browser.send('Page.navigate', { url }, bound.sessionId);
      } catch (error) {
        await clickPath('page-navigate-error', {
          url,
          hintUrl,
          targetId: bound.targetId,
          sessionId: bound.sessionId,
          boundUrl: bound.url,
          error: error.message,
        });
        throw error;
      }
      await clickPath('page-navigate', {
        url,
        hintUrl,
        targetId: bound.targetId,
        sessionId: bound.sessionId,
        boundUrl: bound.url,
        frameId: navigateResult?.frameId || '',
        loaderId: navigateResult?.loaderId || '',
        errorText: navigateResult?.errorText || '',
      });
      if (navigateResult?.errorText) {
        try {
          await browser.send(
            'Runtime.evaluate',
            {
              expression: `location.assign(${JSON.stringify(url)})`,
              userGesture: true,
            },
            bound.sessionId,
          );
          await clickPath('location-assign', {
            url,
            targetId: bound.targetId,
            sessionId: bound.sessionId,
            reason: navigateResult.errorText,
          });
        } catch (error) {
          await clickPath('location-assign-skipped', {
            url,
            targetId: bound.targetId,
            error: error.message,
          });
        }
      }
      return bound;
    },
    async waitForOrigin(url, timeoutMs, targetId) {
      const deadline = Date.now() + timeoutMs;
      let last = '';
      while (Date.now() < deadline) {
        if (closed) throw new Error('WebSocket connection closed');
        try {
          last = targetId ? await urlOfTarget(targetId) : await this.currentUrl();
          if (last && reachedExpectedPage(url, last)) return last;
        } catch (error) {
          if (isCdpDisconnect(error)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      await clickPath('wait-origin-timeout', {
        url,
        targetId: targetId || pageTargetId,
        last,
      });
      return last;
    },
    async navigateAndWait(url, timeoutMs = 10000, hintUrl) {
      const first = await this.navigate(url, hintUrl);
      let reached = await this.waitForOrigin(url, 4000, first.targetId);
      if (reached) return reached;
      const second = await this.navigate(url, hintUrl || first.url);
      reached = await this.waitForOrigin(url, timeoutMs, second.targetId);
      if (reached) return reached;
      throw new Error(`engine did not reach ${url}`);
    },
    async currentUrl() {
      if (pageTargetId) {
        const listed = await urlOfTarget(pageTargetId);
        if (listed) return listed;
      }
      const { frameTree } = await sendToPage('Page.getFrameTree');
      return frameTree?.frame?.url || '';
    },
    async snapshot() {
      const evaluateSnapshot = async (contextId) => {
        const params = { expression: SNAPSHOT_SOURCE, returnByValue: true };
        if (contextId) params.contextId = contextId;
        const { result } = await sendToPage('Runtime.evaluate', params);
        return result?.value || null;
      };

      const top = await evaluateSnapshot();
      if (top?.loginMethod && top?.phone) return top;

      let frameTree;
      try {
        ({ frameTree } = await sendToPage('Page.getFrameTree'));
      } catch {
        return top;
      }

      const children = [];
      const frames = flattenFrames(frameTree).filter(
        (frame) => frame.id && frame.id !== frameTree?.frame?.id && /^https?:/i.test(frame.url || ''),
      );
      for (const frame of frames) {
        try {
          const { executionContextId } = await sendToPage('Page.createIsolatedWorld', {
            frameId: frame.id,
            worldName: 'ai-browser-snapshot',
          });
          const child = await evaluateSnapshot(executionContextId);
          if (child) children.push(child);
        } catch {
          // Cross-process or gone frames stay skipped.
        }
      }
      return mergeObservationSnapshots(top, children);
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

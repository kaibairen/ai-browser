import CDP from 'chrome-remote-interface';
import { FILL_SOURCE, OBSERVER_SOURCE, SNAPSHOT_SOURCE } from './observer.js';

export async function attachEngine(port, handlers) {
  const client = await CDP({ host: '127.0.0.1', port });
  const { Page, Runtime, Target } = client;

  await Target.setAutoAttach({
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false,
  });
  await Page.enable();
  await Runtime.enable();
  await Runtime.addBinding({ name: 'aiBrowserReport' });
  await Page.addScriptToEvaluateOnNewDocument({ source: OBSERVER_SOURCE });

  const onAction = (payload) => {
    try {
      handlers.onAction?.(JSON.parse(payload));
    } catch {
      // Ignore malformed observer payloads.
    }
  };

  Runtime.bindingCalled((event) => {
    if (event.name === 'aiBrowserReport') onAction(event.payload);
  });

  Page.frameNavigated((event) => {
    if (event.frame?.url && event.frame?.parentId == null) {
      handlers.onNavigate?.(event.frame.url);
    }
  });

  Page.loadEventFired(() => {
    handlers.onLoad?.();
  });

  try {
    const { frameTree } = await Page.getFrameTree();
    if (frameTree?.frame?.url) handlers.onNavigate?.(frameTree.frame.url);
    await Runtime.evaluate({ expression: OBSERVER_SOURCE, returnByValue: true });
  } catch {
    // First document may not be ready yet.
  }

  return {
    client,
    async currentUrl() {
      const { frameTree } = await Page.getFrameTree();
      return frameTree?.frame?.url || '';
    },
    async navigate(url) {
      await Page.navigate({ url });
      await Page.bringToFront();
    },
    async snapshot() {
      const { result } = await Runtime.evaluate({
        expression: SNAPSHOT_SOURCE,
        returnByValue: true,
      });
      return result?.value || null;
    },
    async fill(selectors, values) {
      const { result } = await Runtime.evaluate({
        expression: `(${FILL_SOURCE})(${JSON.stringify(selectors || {})}, ${JSON.stringify(values || {})})`,
        returnByValue: true,
      });
      return result?.value || [];
    },
    async focusEngine() {
      try {
        await Page.bringToFront();
      } catch {
        // Focusing the engine is best-effort; the rail must never steal it.
      }
    },
    async close() {
      try {
        await client.close();
      } catch {
        // Already disconnected.
      }
    },
  };
}

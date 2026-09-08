import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { engineProfileDir, railProfileDir } from '../paths.js';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

export async function waitForCdp(port, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // Engine process is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Engine CDP did not come up on port ${port}`);
}

function screenSize() {
  return {
    width: Number(process.env.AI_BROWSER_SCREEN_WIDTH || 1440),
    height: Number(process.env.AI_BROWSER_SCREEN_HEIGHT || 900),
  };
}

export async function launchEngine(binary) {
  const profile = engineProfileDir();
  await mkdir(profile, { recursive: true });
  const port = await freePort();
  const { width, height } = screenSize();
  const railWidth = 280;
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      `--window-position=0,0`,
      `--window-size=${Math.max(800, width - railWidth)},${height}`,
      'about:blank',
    ],
    {
      stdio: 'ignore',
      detached: true,
    },
  );
  child.unref();
  await waitForCdp(port);
  return { port, pid: child.pid, profile };
}

export async function launchRailWindow(binary, railUrl) {
  const profile = railProfileDir();
  await mkdir(profile, { recursive: true });
  const { width, height } = screenSize();
  const railWidth = 280;
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--app=${railUrl}`,
      `--window-position=${Math.max(0, width - railWidth)},0`,
      `--window-size=${railWidth},${height}`,
    ],
    {
      stdio: 'ignore',
      detached: true,
    },
  );
  child.unref();
  return { pid: child.pid, profile };
}

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cacheDir, engineProfileDir, fontCacheDir, railProfileDir, tmpDir } from '../paths.js';
import { detectScreen, engineBounds, railBounds } from './screen.js';
import { placeWindow } from './cdp.js';

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
      // Process is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`CDP did not come up on port ${port}`);
}

async function killPidFile(profile) {
  try {
    const pid = Number(await readFile(`${profile}.pid`, 'utf8'));
    if (pid) process.kill(pid, 'SIGTERM');
  } catch {
    // No previous pid, or already gone.
  }
}

async function chromeEnv() {
  const cache = cacheDir();
  const fonts = fontCacheDir();
  const tmp = tmpDir();
  await mkdir(fonts, { recursive: true });
  await mkdir(tmp, { recursive: true });
  await mkdir(`${cache}/disk`, { recursive: true });
  return {
    ...process.env,
    XDG_CACHE_HOME: cache,
    FONTCONFIG_CACHE: fonts,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
  };
}

function chromeArgs({ profile, port, bounds, appUrl, startUrl }) {
  const args = [
    `--user-data-dir=${profile}`,
    `--disk-cache-dir=${cacheDir()}/disk`,
    '--disk-cache-size=16777216',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-session-crashed-bubble',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-features=TranslateUI,MediaRouter,Vulkan,OptimizationHints',
    '--disable-site-isolation-trials',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--font-render-hinting=none',
    `--window-position=${bounds.left},${bounds.top}`,
    `--window-size=${bounds.width},${bounds.height}`,
  ];
  if (port) {
    args.push(
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
    );
  }
  if (appUrl) args.push(`--app=${appUrl}`);
  else args.push(startUrl || 'about:blank');
  return args;
}

export async function launchEngine(binary, startUrl = 'about:blank') {
  const profile = engineProfileDir();
  await mkdir(profile, { recursive: true });
  await killPidFile(profile);
  const port = await freePort();
  const screen = await detectScreen();
  const bounds = engineBounds(screen);
  const child = spawn(binary, chromeArgs({ profile, port, bounds, startUrl }), {
    stdio: 'ignore',
    env: await chromeEnv(),
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  await waitForCdp(port);
  return { port, pid: child.pid, profile, screen, child };
}

export async function launchRailWindow(binary, railUrl, screen) {
  const profile = railProfileDir();
  await mkdir(profile, { recursive: true });
  await killPidFile(profile);
  const bounds = railBounds(screen || (await detectScreen()));
  const port = await freePort();
  const child = spawn(binary, chromeArgs({ profile, port, bounds, appUrl: railUrl }), {
    stdio: 'ignore',
    env: await chromeEnv(),
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  await waitForCdp(port);
  try {
    await placeWindow(port, bounds);
  } catch {
    // Window may already be in the right place.
  }
  return { port, pid: child.pid, profile, child, bounds };
}

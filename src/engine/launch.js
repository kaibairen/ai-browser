import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { cacheDir, engineProfileDir, fontCacheDir, railProfileDir, tmpDir } from '../paths.js';
import { commandLineBounds, detectScreen, engineBounds, railBounds } from './screen.js';
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

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function windowPlacement(bounds) {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    maximized: false,
  };
}

async function prepareChromeProfile(profile, { bounds, appUrl } = {}) {
  const def = join(profile, 'Default');
  await mkdir(def, { recursive: true });
  try {
    await writeFile(join(profile, 'First Run'), '', { flag: 'wx' });
  } catch {
    // Profile has already seen a first run.
  }

  const prefsPath = join(def, 'Preferences');
  const prefs = await readJson(prefsPath, {});
  prefs.translate = { ...(prefs.translate || {}), enabled: false };
  prefs.offer_translate_enabled = false;
  prefs.translate_blocked_languages = ['zh-CN', 'zh', 'zh-TW', 'en', 'en-US'];
  prefs.intl = {
    ...(prefs.intl || {}),
    accept_languages: 'zh-CN,zh,en-US,en',
    selected_languages: 'zh-CN,zh,en-US,en',
  };
  prefs.browser = {
    ...(prefs.browser || {}),
    enable_spellchecking: false,
    has_seen_welcome_page: true,
    check_default_browser: false,
    should_reset_check_default_browser: false,
  };
  if (bounds && !appUrl) {
    prefs.browser.window_placement = windowPlacement(bounds);
  }
  if (bounds && appUrl) {
    const placement = windowPlacement(bounds);
    const keys = [appUrl];
    try {
      keys.push(`${new URL(appUrl).origin}/`);
    } catch {
      // Keep the raw app URL only.
    }
    prefs.app_window_placement = { ...(prefs.app_window_placement || {}) };
    for (const key of keys) prefs.app_window_placement[key] = placement;
  }
  await writeFile(prefsPath, `${JSON.stringify(prefs)}\n`, 'utf8');
}

function chromeArgs({ profile, port, bounds, appUrl, startUrl }) {
  const inner = commandLineBounds(bounds);
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
    '--disable-translate',
    '--disable-features=Translate,TranslateUI,LanguageDetection,TFLiteLanguageDetection,TranslateKit,MediaRouter,Vulkan,OptimizationHints',
    '--disable-site-isolation-trials',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--font-render-hinting=none',
    `--window-position=${inner.left},${inner.top}`,
    `--window-size=${inner.width},${inner.height}`,
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

async function placeWithRetry(port, bounds, screen) {
  try {
    await placeWindow(port, bounds, screen);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await placeWindow(port, bounds, screen);
  }
  setTimeout(() => {
    placeWindow(port, bounds, screen).catch(() => {});
  }, 400);
}

export async function launchEngine(binary, startUrl = 'about:blank') {
  const profile = engineProfileDir();
  await mkdir(profile, { recursive: true });
  await killPidFile(profile);
  const port = await freePort();
  const screen = await detectScreen();
  const bounds = engineBounds(screen);
  await prepareChromeProfile(profile, { bounds });
  const child = spawn(binary, chromeArgs({ profile, port, bounds, startUrl }), {
    stdio: 'ignore',
    env: await chromeEnv(),
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  await waitForCdp(port);
  try {
    await placeWithRetry(port, bounds, screen);
  } catch {
    // layoutLeftOfRail will try again after attach.
  }
  return { port, pid: child.pid, profile, screen, child };
}

export async function launchRailWindow(binary, railUrl, screen) {
  const profile = railProfileDir();
  await mkdir(profile, { recursive: true });
  await killPidFile(profile);
  const resolvedScreen = screen || (await detectScreen());
  const bounds = railBounds(resolvedScreen);
  await prepareChromeProfile(profile, { bounds, appUrl: railUrl });
  const port = await freePort();
  const child = spawn(binary, chromeArgs({ profile, port, bounds, appUrl: railUrl }), {
    stdio: 'ignore',
    env: await chromeEnv(),
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  await waitForCdp(port);
  try {
    await placeWithRetry(port, bounds, resolvedScreen);
  } catch {
    // The rail page also fits itself on boot.
  }
  return { port, pid: child.pid, profile, child, bounds };
}

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { engineProfileDir, railProfileDir } from '../paths.js';
import { detectScreen, engineBounds, railBounds } from './screen.js';

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

async function killPrevious(profile) {
  try {
    const pid = Number(await readFile(`${profile}.pid`, 'utf8'));
    if (pid) process.kill(pid, 'SIGTERM');
  } catch {
    // No previous pid, or already gone.
  }
  if (process.platform === 'win32') return;
  await new Promise((resolve) => {
    const child = spawn('pkill', ['-f', profile], { stdio: 'ignore' });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function chromeArgs({ profile, port, bounds, appUrl, startUrl }) {
  const args = [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-session-crashed-bubble',
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
  await killPrevious(profile);
  const port = await freePort();
  const screen = await detectScreen();
  const bounds = engineBounds(screen);
  const child = spawn(binary, chromeArgs({ profile, port, bounds, startUrl }), {
    stdio: 'ignore',
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  await waitForCdp(port);
  return { port, pid: child.pid, profile, screen, child };
}

export async function launchRailWindow(binary, railUrl, screen) {
  const profile = railProfileDir();
  await mkdir(profile, { recursive: true });
  await killPrevious(profile);
  const bounds = railBounds(screen || (await detectScreen()));
  const child = spawn(binary, chromeArgs({ profile, bounds, appUrl: railUrl }), {
    stdio: 'ignore',
  });
  await writeFile(`${profile}.pid`, String(child.pid || ''), 'utf8');
  return { pid: child.pid, profile, child };
}

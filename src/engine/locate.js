import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter } from 'node:path';

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
};

const EDGE_CANDIDATES = {
  darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: ['microsoft-edge', 'microsoft-edge-stable'],
};

async function exists(file) {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fromPath(names) {
  const dirs = (process.env.PATH || '').split(delimiter);
  for (const name of names) {
    if (name.includes('/') || name.includes('\\')) {
      if (await exists(name)) return name;
      continue;
    }
    for (const dir of dirs) {
      const full = `${dir}/${name}`.replace(/\\/g, '/');
      if (await exists(full)) return full;
    }
  }
  return null;
}

export async function locateEngineBinary() {
  if (process.env.AI_BROWSER_BINARY) {
    if (await exists(process.env.AI_BROWSER_BINARY)) {
      return { binary: process.env.AI_BROWSER_BINARY, kind: process.env.AI_BROWSER_ENGINE || 'custom' };
    }
    throw new Error(`AI_BROWSER_BINARY not executable: ${process.env.AI_BROWSER_BINARY}`);
  }

  const platform = process.platform;
  const prefer = (process.env.AI_BROWSER_ENGINE || 'chrome').toLowerCase();
  const order =
    prefer === 'edge'
      ? [EDGE_CANDIDATES[platform], CHROME_CANDIDATES[platform]]
      : [CHROME_CANDIDATES[platform], EDGE_CANDIDATES[platform]];

  for (const list of order) {
    const binary = await fromPath(list || []);
    if (binary) {
      const kind = (list || []).some((item) => String(item).toLowerCase().includes('edge'))
        ? 'edge'
        : 'chrome';
      return { binary, kind };
    }
  }

  throw new Error('No local Chrome or Edge binary found. Set AI_BROWSER_BINARY.');
}

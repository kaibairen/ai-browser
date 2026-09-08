import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataRoot() {
  return process.env.AI_BROWSER_HOME || join(homedir(), '.ai-browser');
}

export function engineProfileDir() {
  return join(dataRoot(), 'engine-profile');
}

export function railProfileDir() {
  return join(dataRoot(), 'rail-profile');
}

// Site memory. Shared across Chrome/Edge. Never under engine-profile.
export function storePath() {
  return join(dataRoot(), 'store.json');
}

export function secretsPath() {
  return join(dataRoot(), 'secrets.json');
}

export function cacheDir() {
  return join(dataRoot(), 'cache');
}

export function tmpDir() {
  return join(dataRoot(), 'tmp');
}

export function fontCacheDir() {
  return join(cacheDir(), 'fontconfig');
}

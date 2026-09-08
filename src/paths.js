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

export function storePath() {
  return join(dataRoot(), 'store.json');
}

export function secretsPath() {
  return join(dataRoot(), 'secrets.json');
}

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from './paths.js';

export async function clickPath(event, details = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...details });
  console.log(`[click-path] ${line}`);
  try {
    await mkdir(dataRoot(), { recursive: true });
    await appendFile(join(dataRoot(), 'click-path.log'), `${line}\n`);
  } catch {
    // Tracing must never block the click.
  }
}

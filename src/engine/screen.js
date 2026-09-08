import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RAIL_WIDTH = 280;
export const RAIL_HEIGHT = 520;
export const RAIL_GAP = 16;

export async function detectScreen() {
  const envWidth = Number(process.env.AI_BROWSER_SCREEN_WIDTH || 0);
  const envHeight = Number(process.env.AI_BROWSER_SCREEN_HEIGHT || 0);
  if (envWidth > 0 && envHeight > 0) {
    return { width: envWidth, height: envHeight };
  }

  try {
    const { stdout } = await execFileAsync('xdpyinfo');
    const match = stdout.match(/dimensions:\s+(\d+)x(\d+)/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    // Fall through.
  }

  try {
    const { stdout } = await execFileAsync('xrandr', ['--current']);
    const match = stdout.match(/(\d+)x(\d+)\s+\d+\.[\d]+?\*/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    // Fall through.
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'tell application "Finder" to get bounds of window of desktop',
      ]);
      const parts = stdout.split(',').map((part) => Number(part.trim()));
      if (parts.length === 4) {
        return { width: parts[2] - parts[0], height: parts[3] - parts[1] };
      }
    } catch {
      // Fall through.
    }
  }

  return { width: 1440, height: 900 };
}

export function engineBounds(screen) {
  return {
    left: 0,
    top: 0,
    width: Math.max(640, screen.width - RAIL_WIDTH - RAIL_GAP),
    height: Math.max(480, screen.height),
  };
}

export function railBounds(screen) {
  const width = Math.min(RAIL_WIDTH, Math.max(240, screen.width - 40));
  const left = Math.max(0, Math.min(screen.width - width, engineBounds(screen).width + RAIL_GAP));
  return {
    left,
    top: Math.max(16, Math.min(48, Math.round(screen.height * 0.06))),
    width,
    height: Math.min(RAIL_HEIGHT, Math.max(320, screen.height - 64)),
  };
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RAIL_WIDTH = 252;
export const RAIL_HEIGHT = 248;
export const RAIL_MENTION_HEIGHT = 340;
export const RAIL_CONFIRM_HEIGHT = 460;
export const RAIL_GAP = 16;
export const RAIL_COLLAPSED_WIDTH = 40;
export const RAIL_COLLAPSED_HEIGHT = 96;
export const SCREEN_MARGIN = 16;
// --window-size is the client area. Linux decorations and a title bar sit
// outside that, which is why a 280px rail at x=1000 clipped on 1280.
export const FRAME_SLACK_X = 28;
export const FRAME_SLACK_Y = 48;

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

export function fitOuterBounds(bounds, screen) {
  const width = Math.min(bounds.width, Math.max(40, screen.width - SCREEN_MARGIN * 2));
  const height = Math.min(bounds.height, Math.max(80, screen.height - SCREEN_MARGIN * 2));
  const left = Math.max(
    SCREEN_MARGIN,
    Math.min(bounds.left, screen.width - width - SCREEN_MARGIN),
  );
  const top = Math.max(
    SCREEN_MARGIN,
    Math.min(bounds.top, screen.height - height - SCREEN_MARGIN),
  );
  return { left, top, width, height };
}

export function engineBounds(screen) {
  const railReserve = RAIL_WIDTH + RAIL_GAP + FRAME_SLACK_X + SCREEN_MARGIN;
  return {
    left: 0,
    top: 0,
    width: Math.max(640, screen.width - railReserve),
    height: Math.max(480, screen.height - FRAME_SLACK_Y),
  };
}

function railBox(screen, width, height) {
  const left = Math.max(
    SCREEN_MARGIN,
    screen.width - width - FRAME_SLACK_X - SCREEN_MARGIN,
  );
  const top = Math.max(SCREEN_MARGIN, Math.min(36, Math.round(screen.height * 0.05)));
  return fitOuterBounds({ left, top, width, height }, screen);
}

export function railBounds(screen, extras = {}) {
  return railBoundsFor(screen, extras);
}

export function railBoundsFor(screen, { collapsed = false, proposal = false, mention = false } = {}) {
  if (collapsed) return collapsedRailBounds(screen);
  const width = Math.min(RAIL_WIDTH, Math.max(220, screen.width - 80));
  const height = proposal
    ? Math.min(RAIL_CONFIRM_HEIGHT, Math.max(360, screen.height - 96))
    : mention
      ? Math.min(RAIL_MENTION_HEIGHT, Math.max(300, screen.height - 96))
      : Math.min(RAIL_HEIGHT, Math.max(220, screen.height - 120));
  return railBox(screen, width, height);
}

export function collapsedRailBounds(screen) {
  return railBox(screen, RAIL_COLLAPSED_WIDTH, RAIL_COLLAPSED_HEIGHT);
}

export function commandLineBounds(outer) {
  return {
    left: outer.left,
    top: outer.top,
    width: Math.max(160, outer.width - 8),
    height: Math.max(80, outer.height - 8),
  };
}

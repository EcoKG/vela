/**
 * Centralized semantic color tokens for the Vela TUI.
 *
 * This is a leaf module — it MUST NOT import from any other tui/ file.
 * Components import `theme` and use its tokens instead of hardcoded color strings.
 *
 * Detect-once-at-startup: colorScheme is resolved when this module first loads.
 * The resolved `theme` palette is then used everywhere without runtime branching.
 */

import { execSync } from 'node:child_process';

// ── Types ───────────────────────────────────────────

export interface ThemePalette {
  accent: string;
  highlight: string;
  dim: string;
  error: string;
  success: string;
  text: string | undefined;

  userBubble: string;
  velaBubble: string;
  userLabel: string;
  velaLabel: string;

  toolRunning: string;
  toolComplete: string;
  toolBlocked: string;

  border: string;

  header: {
    brand: string;
    separator: string;
  };
  dashboard: {
    title: string;
    border: string;
  };
  statusBar: {
    bg: string;
    fg: string | undefined;
    accent: string;
    dim: string;
  };
  message: {
    userBg: string | undefined;
    systemBadgeBg: string;
    systemBadgeFg: string;
    separator: string;
  };
  input: {
    prompt: string;
    promptModel: string;
  };
}

// ── Detection ───────────────────────────────────────

/**
 * Detect terminal color scheme at startup.
 *
 * Priority chain:
 * 1. VELA_THEME env var ('light' | 'dark')
 * 2. COLORFGBG env var — last segment as background color index
 * 3. macOS AppleInterfaceStyle (darwin only)
 * 4. Non-TTY → 'dark' (CI/test safety)
 * 5. Default → 'dark'
 */
export function detectColorScheme(): 'dark' | 'light' {
  // 1. Explicit override
  const velaTheme = process.env.VELA_THEME;
  if (velaTheme === 'light' || velaTheme === 'dark') {
    return velaTheme;
  }

  // 2. COLORFGBG — format is "fg;bg" or just "bg". Last segment is bg color index.
  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const parts = colorfgbg.split(';');
    const bgStr = parts[parts.length - 1];
    const bg = parseInt(bgStr, 10);
    if (!isNaN(bg)) {
      // Standard 16-color terminal palette:
      // 0-6: dark colors (black, red, green, yellow, blue, magenta, cyan)
      // 7: white/light — indicates light background
      // 8-15: bright variants of 0-7 — still dark-ish backgrounds
      return bg === 7 ? 'light' : 'dark';
    }
  }

  // 3. macOS: query system appearance
  if (process.platform === 'darwin') {
    try {
      const result = execSync('defaults read -g AppleInterfaceStyle', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.trim().toLowerCase() === 'dark') {
        return 'dark';
      }
      return 'light';
    } catch {
      // Command throws when light mode is active (key doesn't exist)
      return 'light';
    }
  }

  // 4. Non-TTY environments (CI, piped output) → dark
  if (!process.stdout.isTTY) {
    return 'dark';
  }

  // 5. Default
  return 'dark';
}

// ── Palettes ────────────────────────────────────────

/** Dark palette — preserves all original theme values exactly. */
export const darkPalette: ThemePalette = {
  // Core semantic colors
  accent: 'cyan',
  highlight: 'yellow',
  dim: 'gray',
  error: 'red',
  success: 'green',
  text: 'white',

  // Message bubbles
  userBubble: 'green',
  velaBubble: 'cyan',
  userLabel: 'green',
  velaLabel: 'cyan',

  // Tool execution status
  toolRunning: 'yellow',
  toolComplete: 'green',
  toolBlocked: 'red',

  // Borders
  border: 'gray',

  // Component-specific
  header: {
    brand: 'cyan',
    separator: 'gray',
  },
  dashboard: {
    title: 'magenta',
    border: 'magenta',
  },
  statusBar: {
    bg: 'gray',
    fg: 'white',
    accent: 'cyan',
    dim: 'white',
  },
  message: {
    userBg: undefined,
    systemBadgeBg: 'magenta',
    systemBadgeFg: 'white',
    separator: 'gray',
  },
  input: {
    prompt: 'cyan',
    promptModel: 'gray',
  },
};

/** Light palette — same structure, colors suited for light terminal backgrounds. */
export const lightPalette: ThemePalette = {
  // Core semantic colors
  accent: 'blue',
  highlight: 'yellow',
  dim: 'gray',
  error: 'red',
  success: 'green',
  text: undefined, // Use terminal default (typically black on light)

  // Message bubbles
  userBubble: 'green',
  velaBubble: 'blue',
  userLabel: 'green',
  velaLabel: 'blue',

  // Tool execution status
  toolRunning: 'yellow',
  toolComplete: 'green',
  toolBlocked: 'red',

  // Borders
  border: 'gray',

  // Component-specific
  header: {
    brand: 'blue',
    separator: 'gray',
  },
  dashboard: {
    title: 'magenta',
    border: 'magenta',
  },
  statusBar: {
    bg: 'white',
    fg: 'black',
    accent: 'blue',
    dim: 'gray',
  },
  message: {
    userBg: undefined,
    systemBadgeBg: 'magenta',
    systemBadgeFg: 'white',
    separator: 'gray',
  },
  input: {
    prompt: 'blue',
    promptModel: 'gray',
  },
};

// ── Resolved exports (detect once at startup) ───────

export const colorScheme = detectColorScheme();
export const theme: ThemePalette = colorScheme === 'dark' ? darkPalette : lightPalette;

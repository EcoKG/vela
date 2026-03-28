import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Valid named colors accepted by ink's <Text color="..."> prop.
// ink supports the 16 basic terminal colors.
const VALID_INK_COLORS = new Set([
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'gray', 'grey',
  'blackBright', 'redBright', 'greenBright', 'yellowBright',
  'blueBright', 'magentaBright', 'cyanBright', 'whiteBright',
]);

function isValidColor(value: unknown): boolean {
  if (value === undefined) return true; // undefined means "use terminal default" — valid for light palette text
  return typeof value === 'string' && VALID_INK_COLORS.has(value);
}

/** Recursively collect all leaf values from an object. */
function collectLeafValues(obj: Record<string, unknown>, prefix = ''): Array<{ path: string; value: unknown }> {
  const entries: Array<{ path: string; value: unknown }> = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      entries.push(...collectLeafValues(val as Record<string, unknown>, path));
    } else {
      entries.push({ path, value: val });
    }
  }
  return entries;
}

/** Recursively collect all leaf key paths from an object. */
function collectKeyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      paths.push(...collectKeyPaths(val as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

// ── Static import tests (resolved theme export) ────

describe('theme (static export)', () => {
  // These tests use the statically resolved theme — they validate
  // that the module exports work correctly regardless of detection result.

  it('exports a theme object', async () => {
    const { theme } = await import('../src/tui/theme.js');
    expect(theme).toBeDefined();
    expect(typeof theme).toBe('object');
  });

  it('has all expected top-level keys', async () => {
    const { theme } = await import('../src/tui/theme.js');
    const expectedKeys = [
      'accent', 'highlight', 'dim', 'error', 'success', 'text',
      'userBubble', 'velaBubble', 'userLabel', 'velaLabel',
      'toolRunning', 'toolComplete', 'toolBlocked',
      'border',
      'header', 'dashboard',
    ];
    for (const key of expectedKeys) {
      expect(theme).toHaveProperty(key);
    }
  });

  it('has nested header keys', async () => {
    const { theme } = await import('../src/tui/theme.js');
    expect(theme.header).toHaveProperty('brand');
    expect(theme.header).toHaveProperty('separator');
  });

  it('has nested dashboard keys', async () => {
    const { theme } = await import('../src/tui/theme.js');
    expect(theme.dashboard).toHaveProperty('title');
    expect(theme.dashboard).toHaveProperty('border');
  });

  it('all leaf values are valid ink color strings (or undefined for text)', async () => {
    const { theme } = await import('../src/tui/theme.js');
    const leaves = collectLeafValues(theme as unknown as Record<string, unknown>);
    expect(leaves.length).toBeGreaterThan(0);

    for (const { path, value } of leaves) {
      expect(isValidColor(value), `theme.${path} = "${value}" is not a valid ink color`).toBe(true);
    }
  });

  it('theme is a leaf module (zero tui/ imports)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'tui', 'theme.ts'),
      'utf-8',
    );
    const tuiImports = src.match(/from\s+['"]\.\/(Header|Dashboard|GovernanceStatus|HelpOverlay|ToolStatus|MessageList|ChatApp|ChatInput|shortcuts)/g);
    expect(tuiImports).toBeNull();
  });

  it('exports colorScheme as dark or light', async () => {
    const { colorScheme } = await import('../src/tui/theme.js');
    expect(['dark', 'light']).toContain(colorScheme);
  });

  it('exports ThemePalette type (structural check via palettes)', async () => {
    const { darkPalette, lightPalette } = await import('../src/tui/theme.js');
    // Both palettes exist and are objects — type exported for consumers
    expect(typeof darkPalette).toBe('object');
    expect(typeof lightPalette).toBe('object');
  });
});

// ── Dual palette validation ─────────────────────────

describe('dual palettes', () => {
  it('darkPalette and lightPalette have identical key structures', async () => {
    const { darkPalette, lightPalette } = await import('../src/tui/theme.js');
    const darkKeys = collectKeyPaths(darkPalette as unknown as Record<string, unknown>).sort();
    const lightKeys = collectKeyPaths(lightPalette as unknown as Record<string, unknown>).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('darkPalette preserves all original theme values', async () => {
    const { darkPalette } = await import('../src/tui/theme.js');
    // These are the exact values from the original static theme
    expect(darkPalette.accent).toBe('cyan');
    expect(darkPalette.highlight).toBe('yellow');
    expect(darkPalette.dim).toBe('gray');
    expect(darkPalette.error).toBe('red');
    expect(darkPalette.success).toBe('green');
    expect(darkPalette.text).toBe('white');
    expect(darkPalette.userBubble).toBe('green');
    expect(darkPalette.velaBubble).toBe('cyan');
    expect(darkPalette.userLabel).toBe('green');
    expect(darkPalette.velaLabel).toBe('cyan');
    expect(darkPalette.toolRunning).toBe('yellow');
    expect(darkPalette.toolComplete).toBe('green');
    expect(darkPalette.toolBlocked).toBe('red');
    expect(darkPalette.border).toBe('gray');
    expect(darkPalette.header.brand).toBe('cyan');
    expect(darkPalette.header.separator).toBe('gray');
    expect(darkPalette.dashboard.title).toBe('magenta');
    expect(darkPalette.dashboard.border).toBe('magenta');
  });

  it('lightPalette has light-appropriate colors', async () => {
    const { lightPalette } = await import('../src/tui/theme.js');
    expect(lightPalette.text).toBeUndefined(); // terminal default
    expect(lightPalette.accent).toBe('blue');
    expect(lightPalette.velaBubble).toBe('blue');
    expect(lightPalette.velaLabel).toBe('blue');
    expect(lightPalette.header.brand).toBe('blue');
  });

  it('both palettes have all valid ink colors (or undefined)', async () => {
    const { darkPalette, lightPalette } = await import('../src/tui/theme.js');

    for (const [label, palette] of [['dark', darkPalette], ['light', lightPalette]] as const) {
      const leaves = collectLeafValues(palette as unknown as Record<string, unknown>);
      expect(leaves.length).toBe(18); // 18 leaf tokens
      for (const { path, value } of leaves) {
        expect(isValidColor(value), `${label}Palette.${path} = "${value}" is not valid`).toBe(true);
      }
    }
  });
});

// ── Detection priority chain tests ──────────────────

describe('detectColorScheme()', () => {
  // detectColorScheme is a pure function that reads process.env/process.platform
  // at call time, so we can import it once and control env per test.
  let detect: typeof import('../src/tui/theme.js')['detectColorScheme'];

  let savedVelaTheme: string | undefined;
  let savedColorfgbg: string | undefined;
  let originalPlatform: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    const mod = await import('../src/tui/theme.js');
    detect = mod.detectColorScheme;

    savedVelaTheme = process.env.VELA_THEME;
    savedColorfgbg = process.env.COLORFGBG;
    originalPlatform = process.platform;
    originalIsTTY = process.stdout.isTTY;
    // Clean detection-relevant env vars
    delete process.env.VELA_THEME;
    delete process.env.COLORFGBG;
  });

  afterEach(() => {
    if (savedVelaTheme !== undefined) process.env.VELA_THEME = savedVelaTheme;
    else delete process.env.VELA_THEME;
    if (savedColorfgbg !== undefined) process.env.COLORFGBG = savedColorfgbg;
    else delete process.env.COLORFGBG;
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true, configurable: true });
  });

  describe('Priority 1: VELA_THEME env var', () => {
    it('returns dark when VELA_THEME=dark', () => {
      process.env.VELA_THEME = 'dark';
      expect(detect()).toBe('dark');
    });

    it('returns light when VELA_THEME=light', () => {
      process.env.VELA_THEME = 'light';
      expect(detect()).toBe('light');
    });

    it('VELA_THEME takes priority over COLORFGBG', () => {
      process.env.VELA_THEME = 'light';
      process.env.COLORFGBG = '15;0'; // would indicate dark
      expect(detect()).toBe('light');
    });

    it('ignores invalid VELA_THEME values', () => {
      process.env.VELA_THEME = 'sepia';
      // Should fall through to later checks — on non-TTY, defaults to dark
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      expect(detect()).toBe('dark');
    });
  });

  describe('Priority 2: COLORFGBG env var', () => {
    // Need to be on non-darwin to avoid macOS detection kicking in
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    });

    it('COLORFGBG "15;0" → dark (bg=0, black)', () => {
      process.env.COLORFGBG = '15;0';
      expect(detect()).toBe('dark');
    });

    it('COLORFGBG "0;7" → light (bg=7, white)', () => {
      process.env.COLORFGBG = '0;7';
      expect(detect()).toBe('light');
    });

    it('COLORFGBG "0;15" → dark (bg=15, bright white is still dark palette)', () => {
      process.env.COLORFGBG = '0;15';
      expect(detect()).toBe('dark');
    });

    it('COLORFGBG "7" → light (single segment, bg=7)', () => {
      process.env.COLORFGBG = '7';
      expect(detect()).toBe('light');
    });

    it('COLORFGBG malformed "abc" → falls through to default dark', () => {
      process.env.COLORFGBG = 'abc';
      expect(detect()).toBe('dark');
    });

    it('COLORFGBG with three segments uses last one', () => {
      process.env.COLORFGBG = '15;0;7';
      expect(detect()).toBe('light');
    });
  });

  describe('Priority 4: Non-TTY fallback', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    });

    it('returns dark when stdout is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
      expect(detect()).toBe('dark');
    });

    it('returns dark when isTTY is undefined', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true, configurable: true });
      expect(detect()).toBe('dark');
    });
  });

  describe('Priority 5: Default', () => {
    it('returns dark as the final default on non-darwin TTY', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      expect(detect()).toBe('dark');
    });
  });
});

// ── HelpOverlay completeness guard ──────────────────

describe('HelpOverlay slash command completeness', () => {
  const EXPECTED_COMMANDS = ['/help', '/quit', '/clear', '/sessions', '/model', '/fresh', '/budget', '/auto'];

  it('lists all expected slash commands in HelpOverlay source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'tui', 'HelpOverlay.tsx'),
      'utf-8',
    );

    for (const cmd of EXPECTED_COMMANDS) {
      expect(src, `HelpOverlay is missing slash command: ${cmd}`).toContain(`'${cmd}'`);
    }
  });

  it('has exactly 8 slash command entries', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'tui', 'HelpOverlay.tsx'),
      'utf-8',
    );

    // Each slash command uses the pattern: {'/<command>'.padEnd(12)}
    const commandEntries = src.match(/\{'\/[a-z]+'.padEnd\(12\)\}/g);
    expect(commandEntries).not.toBeNull();
    expect(commandEntries!.length).toBe(8);
  });
});

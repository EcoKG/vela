/**
 * Keyboard input handling for terminal applications.
 *
 * Supports both legacy terminal sequences and Kitty keyboard protocol.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * Reference: https://github.com/sst/opentui/blob/7da92b4088aebfe27b9f691c04163a48821e49fd/packages/core/src/lib/parse.keypress.ts
 *
 * Symbol keys are also supported, however some ctrl+symbol combos
 * overlap with ASCII codes, e.g. ctrl+[ = ESC.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-ctrl-mapping-of-ascii-keys
 * Those can still be used for ctrl+shift combos
 *
 * API:
 * - matchesKey(data, keyId) - Check if input matches a key identifier
 * - parseKey(data) - Parse input and return the key identifier
 * - Key - Helper object for creating typed key identifiers
 * - setKittyProtocolActive(active) - Set global Kitty protocol state
 * - isKittyProtocolActive() - Query global Kitty protocol state
 */

// =============================================================================
// Types
// =============================================================================

/** A key identifier string like "escape", "ctrl+c", "shift+enter", etc. */
export type KeyId = string;

/** Parsed components of a key identifier */
export interface ParsedKeyId {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** Kitty event types */
export type KittyEventType = 'press' | 'repeat' | 'release';

/** Parsed Kitty CSI-u sequence */
interface KittySequence {
  codepoint: number;
  shiftedKey?: number;
  baseLayoutKey?: number;
  modifier: number;
  eventType: KittyEventType;
}

/** Parsed modifyOtherKeys sequence */
interface ModifyOtherKeysSequence {
  codepoint: number;
  modifier: number;
}

/** Legacy sequence entry with plain, shift, and ctrl variants */
interface LegacySequenceEntry {
  plain: string[];
  shift?: string[];
  ctrl?: string[];
}

// =============================================================================
// Global Kitty Protocol State
// =============================================================================

let _kittyProtocolActive = false;

/**
 * Set the global Kitty keyboard protocol state.
 * Called by ProcessTerminal after detecting protocol support.
 */
export function setKittyProtocolActive(active: boolean): void {
  _kittyProtocolActive = active;
}

/**
 * Query whether Kitty keyboard protocol is currently active.
 */
export function isKittyProtocolActive(): boolean {
  return _kittyProtocolActive;
}

/**
 * Helper object for creating typed key identifiers with autocomplete.
 *
 * Usage:
 * - Key.escape, Key.enter, Key.tab, etc. for special keys
 * - Key.backtick, Key.comma, Key.period, etc. for symbol keys
 * - Key.ctrl("c"), Key.alt("x") for single modifier
 * - Key.ctrlShift("p"), Key.ctrlAlt("x") for combined modifiers
 */
export const Key = {
  // Special keys
  escape: 'escape' as KeyId,
  esc: 'esc' as KeyId,
  enter: 'enter' as KeyId,
  return: 'return' as KeyId,
  tab: 'tab' as KeyId,
  space: 'space' as KeyId,
  backspace: 'backspace' as KeyId,
  delete: 'delete' as KeyId,
  insert: 'insert' as KeyId,
  clear: 'clear' as KeyId,
  home: 'home' as KeyId,
  end: 'end' as KeyId,
  pageUp: 'pageUp' as KeyId,
  pageDown: 'pageDown' as KeyId,
  up: 'up' as KeyId,
  down: 'down' as KeyId,
  left: 'left' as KeyId,
  right: 'right' as KeyId,
  f1: 'f1' as KeyId,
  f2: 'f2' as KeyId,
  f3: 'f3' as KeyId,
  f4: 'f4' as KeyId,
  f5: 'f5' as KeyId,
  f6: 'f6' as KeyId,
  f7: 'f7' as KeyId,
  f8: 'f8' as KeyId,
  f9: 'f9' as KeyId,
  f10: 'f10' as KeyId,
  f11: 'f11' as KeyId,
  f12: 'f12' as KeyId,

  // Symbol keys
  backtick: '`' as KeyId,
  hyphen: '-' as KeyId,
  equals: '=' as KeyId,
  leftbracket: '[' as KeyId,
  rightbracket: ']' as KeyId,
  backslash: '\\' as KeyId,
  semicolon: ';' as KeyId,
  quote: "'" as KeyId,
  comma: ',' as KeyId,
  period: '.' as KeyId,
  slash: '/' as KeyId,
  exclamation: '!' as KeyId,
  at: '@' as KeyId,
  hash: '#' as KeyId,
  dollar: '$' as KeyId,
  percent: '%' as KeyId,
  caret: '^' as KeyId,
  ampersand: '&' as KeyId,
  asterisk: '*' as KeyId,
  leftparen: '(' as KeyId,
  rightparen: ')' as KeyId,
  underscore: '_' as KeyId,
  plus: '+' as KeyId,
  pipe: '|' as KeyId,
  tilde: '~' as KeyId,
  leftbrace: '{' as KeyId,
  rightbrace: '}' as KeyId,
  colon: ':' as KeyId,
  lessthan: '<' as KeyId,
  greaterthan: '>' as KeyId,
  question: '?' as KeyId,

  // Single modifiers
  ctrl: (key: string): KeyId => `ctrl+${key}`,
  shift: (key: string): KeyId => `shift+${key}`,
  alt: (key: string): KeyId => `alt+${key}`,

  // Combined modifiers
  ctrlShift: (key: string): KeyId => `ctrl+shift+${key}`,
  shiftCtrl: (key: string): KeyId => `shift+ctrl+${key}`,
  ctrlAlt: (key: string): KeyId => `ctrl+alt+${key}`,
  altCtrl: (key: string): KeyId => `alt+ctrl+${key}`,
  shiftAlt: (key: string): KeyId => `shift+alt+${key}`,
  altShift: (key: string): KeyId => `alt+shift+${key}`,

  // Triple modifiers
  ctrlShiftAlt: (key: string): KeyId => `ctrl+shift+alt+${key}`,
} as const;

// =============================================================================
// Constants
// =============================================================================

const SYMBOL_KEYS = new Set([
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
  '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
  '_', '+', '|', '~', '{', '}', ':', '<', '>', '?',
]);

const MODIFIERS = {
  shift: 1,
  alt: 2,
  ctrl: 4,
} as const;

const LOCK_MASK = 64 + 128; // Caps Lock + Num Lock

const CODEPOINTS = {
  escape: 27,
  tab: 9,
  enter: 13,
  space: 32,
  backspace: 127,
  kpEnter: 57414, // Numpad Enter (Kitty protocol)
} as const;

const ARROW_CODEPOINTS: Record<string, number> = {
  up: -1,
  down: -2,
  right: -3,
  left: -4,
};

const FUNCTIONAL_CODEPOINTS: Record<string, number> = {
  delete: -10,
  insert: -11,
  pageUp: -12,
  pageDown: -13,
  home: -14,
  end: -15,
};

/**
 * Consolidated legacy terminal key sequences.
 * Each key maps to its sequences for unmodified, shift-modified, and ctrl-modified variants.
 */
const LEGACY_SEQUENCES: Record<string, LegacySequenceEntry> = {
  up: { plain: ['\x1b[A', '\x1bOA'], shift: ['\x1b[a'], ctrl: ['\x1bOa'] },
  down: { plain: ['\x1b[B', '\x1bOB'], shift: ['\x1b[b'], ctrl: ['\x1bOb'] },
  right: { plain: ['\x1b[C', '\x1bOC'], shift: ['\x1b[c'], ctrl: ['\x1bOc'] },
  left: { plain: ['\x1b[D', '\x1bOD'], shift: ['\x1b[d'], ctrl: ['\x1bOd'] },
  home: { plain: ['\x1b[H', '\x1bOH', '\x1b[1~', '\x1b[7~'], shift: ['\x1b[7$'], ctrl: ['\x1b[7^'] },
  end: { plain: ['\x1b[F', '\x1bOF', '\x1b[4~', '\x1b[8~'], shift: ['\x1b[8$'], ctrl: ['\x1b[8^'] },
  insert: { plain: ['\x1b[2~'], shift: ['\x1b[2$'], ctrl: ['\x1b[2^'] },
  delete: { plain: ['\x1b[3~'], shift: ['\x1b[3$'], ctrl: ['\x1b[3^'] },
  pageUp: { plain: ['\x1b[5~', '\x1b[[5~'], shift: ['\x1b[5$'], ctrl: ['\x1b[5^'] },
  pageDown: { plain: ['\x1b[6~', '\x1b[[6~'], shift: ['\x1b[6$'], ctrl: ['\x1b[6^'] },
  clear: { plain: ['\x1b[E', '\x1bOE'], shift: ['\x1b[e'], ctrl: ['\x1bOe'] },
  f1: { plain: ['\x1bOP', '\x1b[11~', '\x1b[[A'] },
  f2: { plain: ['\x1bOQ', '\x1b[12~', '\x1b[[B'] },
  f3: { plain: ['\x1bOR', '\x1b[13~', '\x1b[[C'] },
  f4: { plain: ['\x1bOS', '\x1b[14~', '\x1b[[D'] },
  f5: { plain: ['\x1b[15~', '\x1b[[E'] },
  f6: { plain: ['\x1b[17~'] },
  f7: { plain: ['\x1b[18~'] },
  f8: { plain: ['\x1b[19~'] },
  f9: { plain: ['\x1b[20~'] },
  f10: { plain: ['\x1b[21~'] },
  f11: { plain: ['\x1b[23~'] },
  f12: { plain: ['\x1b[24~'] },
};

/**
 * Reverse lookup from escape sequence to key identifier, auto-generated from LEGACY_SEQUENCES.
 */
const LEGACY_SEQUENCE_KEY_IDS: Record<string, KeyId> = (() => {
  const map: Record<string, KeyId> = {};
  for (const [key, entry] of Object.entries(LEGACY_SEQUENCES)) {
    const keyId: KeyId = key;
    if (entry.plain) {
      for (const seq of entry.plain) map[seq] = keyId;
    }
    if (entry.shift) {
      for (const seq of entry.shift) map[seq] = `shift+${keyId}`;
    }
    if (entry.ctrl) {
      for (const seq of entry.ctrl) map[seq] = `ctrl+${keyId}`;
    }
  }
  // Non-standard alt+arrow aliases not derivable from the table
  map['\x1bb'] = 'alt+left';
  map['\x1bf'] = 'alt+right';
  map['\x1bp'] = 'alt+up';
  map['\x1bn'] = 'alt+down';
  return map;
})();

const matchesLegacySequence = (data: string, sequences: string[]): boolean =>
  sequences.includes(data);

const matchesLegacyModifierSequence = (data: string, key: string, modifier: number): boolean => {
  const entry = LEGACY_SEQUENCES[key];
  if (!entry) return false;
  if (modifier === MODIFIERS.shift && entry.shift) {
    return matchesLegacySequence(data, entry.shift);
  }
  if (modifier === MODIFIERS.ctrl && entry.ctrl) {
    return matchesLegacySequence(data, entry.ctrl);
  }
  return false;
};

// Store the last parsed event type for isKeyRelease() to query
let _lastEventType: KittyEventType = 'press';

/**
 * Check if input data contains a Kitty event type marker.
 */
function hasKittyEventType(data: string, eventType: number): boolean {
  if (data.includes('\x1b[200~')) {
    return false;
  }
  const marker = `:${eventType}`;
  return (
    data.includes(`${marker}u`) ||
    data.includes(`${marker}~`) ||
    data.includes(`${marker}A`) ||
    data.includes(`${marker}B`) ||
    data.includes(`${marker}C`) ||
    data.includes(`${marker}D`) ||
    data.includes(`${marker}H`) ||
    data.includes(`${marker}F`)
  );
}

export function isKeyRelease(data: string): boolean {
  return hasKittyEventType(data, 3);
}

/**
 * Check if the last parsed key event was a key repeat.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 */
export function isKeyRepeat(data: string): boolean {
  return hasKittyEventType(data, 2);
}

function parseEventType(eventTypeStr: string | undefined): KittyEventType {
  if (!eventTypeStr) return 'press';
  const eventType = parseInt(eventTypeStr, 10);
  if (eventType === 2) return 'repeat';
  if (eventType === 3) return 'release';
  return 'press';
}

function parseKittySequence(data: string): KittySequence | null {
  // CSI u format with alternate keys (flag 4):
  // \x1b[<codepoint>u
  // \x1b[<codepoint>;<mod>u
  // \x1b[<codepoint>;<mod>:<event>u
  // \x1b[<codepoint>:<shifted>;<mod>u
  // \x1b[<codepoint>:<shifted>:<base>;<mod>u
  // \x1b[<codepoint>::<base>;<mod>u (no shifted key, only base)
  const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (csiUMatch) {
    const codepoint = parseInt(csiUMatch[1]!, 10);
    const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : undefined;
    const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : undefined;
    const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
    const eventType = parseEventType(csiUMatch[5]);
    _lastEventType = eventType;
    return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
  }

  // Arrow keys with modifier: \x1b[1;<mod>A/B/C/D or \x1b[1;<mod>:<event>A/B/C/D
  const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
  if (arrowMatch) {
    const modValue = parseInt(arrowMatch[1]!, 10);
    const eventType = parseEventType(arrowMatch[2]);
    const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
    _lastEventType = eventType;
    return { codepoint: arrowCodes[arrowMatch[3]!]!, modifier: modValue - 1, eventType };
  }

  // Functional keys: \x1b[<num>~ or \x1b[<num>;<mod>~ or \x1b[<num>;<mod>:<event>~
  const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
  if (funcMatch) {
    const keyNum = parseInt(funcMatch[1]!, 10);
    const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
    const eventType = parseEventType(funcMatch[3]);
    const funcCodes: Record<number, number> = {
      2: FUNCTIONAL_CODEPOINTS['insert']!,
      3: FUNCTIONAL_CODEPOINTS['delete']!,
      5: FUNCTIONAL_CODEPOINTS['pageUp']!,
      6: FUNCTIONAL_CODEPOINTS['pageDown']!,
      7: FUNCTIONAL_CODEPOINTS['home']!,
      8: FUNCTIONAL_CODEPOINTS['end']!,
    };
    const codepoint = funcCodes[keyNum];
    if (codepoint !== undefined) {
      _lastEventType = eventType;
      return { codepoint, modifier: modValue - 1, eventType };
    }
  }

  // Home/End with modifier: \x1b[1;<mod>H/F or \x1b[1;<mod>:<event>H/F
  const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
  if (homeEndMatch) {
    const modValue = parseInt(homeEndMatch[1]!, 10);
    const eventType = parseEventType(homeEndMatch[2]);
    const codepoint = homeEndMatch[3] === 'H' ? FUNCTIONAL_CODEPOINTS['home']! : FUNCTIONAL_CODEPOINTS['end']!;
    _lastEventType = eventType;
    return { codepoint, modifier: modValue - 1, eventType };
  }

  return null;
}

function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
  const parsed = parseKittySequence(data);
  if (!parsed) return false;

  const actualMod = parsed.modifier & ~LOCK_MASK;
  const expectedMod = expectedModifier & ~LOCK_MASK;

  if (actualMod !== expectedMod) return false;

  // Primary match: codepoint matches directly
  if (parsed.codepoint === expectedCodepoint) return true;

  // Alternate match: use base layout key for non-Latin keyboard layouts.
  if (parsed.baseLayoutKey !== undefined && parsed.baseLayoutKey === expectedCodepoint) {
    const cp = parsed.codepoint;
    const isLatinLetter = cp >= 97 && cp <= 122; // a-z
    const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(cp));
    if (!isLatinLetter && !isKnownSymbol) return true;
  }

  return false;
}

function parseModifyOtherKeysSequence(data: string): ModifyOtherKeysSequence | null {
  const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (!match) return null;
  const modValue = parseInt(match[1]!, 10);
  const codepoint = parseInt(match[2]!, 10);
  return { codepoint, modifier: modValue - 1 };
}

/**
 * Match xterm modifyOtherKeys format: CSI 27 ; modifiers ; keycode ~
 */
function matchesModifyOtherKeys(data: string, expectedKeycode: number, expectedModifier: number): boolean {
  const parsed = parseModifyOtherKeysSequence(data);
  if (!parsed) return false;
  return parsed.codepoint === expectedKeycode && parsed.modifier === expectedModifier;
}

// =============================================================================
// Generic Key Matching
// =============================================================================

/**
 * Get the control character for a key.
 * Uses the universal formula: code & 0x1f (mask to lower 5 bits)
 */
function rawCtrlChar(key: string): string | null {
  const char = key.toLowerCase();
  const code = char.charCodeAt(0);
  if ((code >= 97 && code <= 122) || char === '[' || char === '\\' || char === ']' || char === '_') {
    return String.fromCharCode(code & 0x1f);
  }
  if (char === '-') {
    return String.fromCharCode(31); // Same as Ctrl+_
  }
  return null;
}

function isDigitKey(key: string): boolean {
  return key >= '0' && key <= '9';
}

function matchesPrintableModifyOtherKeys(data: string, expectedKeycode: number, expectedModifier: number): boolean {
  if (expectedModifier === 0) return false;
  return matchesModifyOtherKeys(data, expectedKeycode, expectedModifier);
}

function formatKeyNameWithModifiers(keyName: string, modifier: number): KeyId | undefined {
  const mods: string[] = [];
  const effectiveMod = modifier & ~LOCK_MASK;
  const supportedModifierMask = MODIFIERS.shift | MODIFIERS.ctrl | MODIFIERS.alt;
  if ((effectiveMod & ~supportedModifierMask) !== 0) return undefined;

  if (effectiveMod & MODIFIERS.shift) mods.push('shift');
  if (effectiveMod & MODIFIERS.ctrl) mods.push('ctrl');
  if (effectiveMod & MODIFIERS.alt) mods.push('alt');

  return mods.length > 0 ? `${mods.join('+')}+${keyName}` : keyName;
}

function parseKeyId(keyId: string): ParsedKeyId | null {
  const parts = keyId.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  if (!key) return null;
  return {
    key,
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

/**
 * Match input data against a key identifier string.
 *
 * Supported key identifiers:
 * - Single keys: "escape", "tab", "enter", "backspace", "delete", "home", "end", "space"
 * - Arrow keys: "up", "down", "left", "right"
 * - Ctrl combinations: "ctrl+c", "ctrl+z", etc.
 * - Shift combinations: "shift+tab", "shift+enter"
 * - Alt combinations: "alt+enter", "alt+backspace"
 * - Combined modifiers: "shift+ctrl+p", "ctrl+alt+x"
 *
 * Use the Key helper for autocomplete: Key.ctrl("c"), Key.escape, Key.ctrlShift("p")
 */
export function matchesKey(data: string, keyId: KeyId): boolean {
  const parsed = parseKeyId(keyId);
  if (!parsed) return false;

  const { key, ctrl, shift, alt } = parsed;
  let modifier = 0;
  if (shift) modifier |= MODIFIERS.shift;
  if (alt) modifier |= MODIFIERS.alt;
  if (ctrl) modifier |= MODIFIERS.ctrl;

  switch (key) {
    case 'escape':
    case 'esc':
      if (modifier !== 0) return false;
      return data === '\x1b' || matchesKittySequence(data, CODEPOINTS.escape, 0);

    case 'space':
      if (!_kittyProtocolActive) {
        if (ctrl && !alt && !shift && data === '\x00') return true;
        if (alt && !ctrl && !shift && data === '\x1b ') return true;
      }
      if (modifier === 0) {
        return data === ' ' || matchesKittySequence(data, CODEPOINTS.space, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.space, modifier);

    case 'tab':
      if (shift && !ctrl && !alt) {
        return data === '\x1b[Z' || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift);
      }
      if (modifier === 0) {
        return data === '\t' || matchesKittySequence(data, CODEPOINTS.tab, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.tab, modifier);

    case 'enter':
    case 'return':
      if (shift && !ctrl && !alt) {
        if (
          matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) ||
          matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)
        ) {
          return true;
        }
        if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) {
          return true;
        }
        if (_kittyProtocolActive) {
          return data === '\x1b\r' || data === '\n';
        }
        return false;
      }
      if (alt && !ctrl && !shift) {
        if (
          matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) ||
          matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)
        ) {
          return true;
        }
        if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) {
          return true;
        }
        if (!_kittyProtocolActive) {
          return data === '\x1b\r';
        }
        return false;
      }
      if (modifier === 0) {
        return (
          data === '\r' ||
          (!_kittyProtocolActive && data === '\n') ||
          data === '\x1bOM' ||
          matchesKittySequence(data, CODEPOINTS.enter, 0) ||
          matchesKittySequence(data, CODEPOINTS.kpEnter, 0)
        );
      }
      return (
        matchesKittySequence(data, CODEPOINTS.enter, modifier) ||
        matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) ||
        matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier)
      );

    case 'backspace':
      if (alt && !ctrl && !shift) {
        if (data === '\x1b\x7f' || data === '\x1b\b') return true;
        return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return data === '\x7f' || data === '\x08' || matchesKittySequence(data, CODEPOINTS.backspace, 0);
      }
      return matchesKittySequence(data, CODEPOINTS.backspace, modifier);

    case 'insert':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['insert']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['insert']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'insert', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['insert']!, modifier);

    case 'delete':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['delete']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['delete']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'delete', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['delete']!, modifier);

    case 'clear':
      if (modifier === 0) {
        return matchesLegacySequence(data, LEGACY_SEQUENCES['clear']!.plain);
      }
      return matchesLegacyModifierSequence(data, 'clear', modifier);

    case 'home':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['home']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['home']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'home', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['home']!, modifier);

    case 'end':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['end']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['end']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'end', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['end']!, modifier);

    case 'pageup':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['pageUp']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['pageUp']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'pageUp', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['pageUp']!, modifier);

    case 'pagedown':
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['pageDown']!.plain) ||
          matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['pageDown']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'pageDown', modifier)) return true;
      return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS['pageDown']!, modifier);

    case 'up':
      if (alt && !ctrl && !shift) {
        return data === '\x1bp' || matchesKittySequence(data, ARROW_CODEPOINTS['up']!, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['up']!.plain) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['up']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'up', modifier)) return true;
      return matchesKittySequence(data, ARROW_CODEPOINTS['up']!, modifier);

    case 'down':
      if (alt && !ctrl && !shift) {
        return data === '\x1bn' || matchesKittySequence(data, ARROW_CODEPOINTS['down']!, MODIFIERS.alt);
      }
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['down']!.plain) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['down']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'down', modifier)) return true;
      return matchesKittySequence(data, ARROW_CODEPOINTS['down']!, modifier);

    case 'left':
      if (alt && !ctrl && !shift) {
        return (
          data === '\x1b[1;3D' ||
          (!_kittyProtocolActive && data === '\x1bB') ||
          data === '\x1bb' ||
          matchesKittySequence(data, ARROW_CODEPOINTS['left']!, MODIFIERS.alt)
        );
      }
      if (ctrl && !alt && !shift) {
        return (
          data === '\x1b[1;5D' ||
          matchesLegacyModifierSequence(data, 'left', MODIFIERS.ctrl) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['left']!, MODIFIERS.ctrl)
        );
      }
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['left']!.plain) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['left']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'left', modifier)) return true;
      return matchesKittySequence(data, ARROW_CODEPOINTS['left']!, modifier);

    case 'right':
      if (alt && !ctrl && !shift) {
        return (
          data === '\x1b[1;3C' ||
          (!_kittyProtocolActive && data === '\x1bF') ||
          data === '\x1bf' ||
          matchesKittySequence(data, ARROW_CODEPOINTS['right']!, MODIFIERS.alt)
        );
      }
      if (ctrl && !alt && !shift) {
        return (
          data === '\x1b[1;5C' ||
          matchesLegacyModifierSequence(data, 'right', MODIFIERS.ctrl) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['right']!, MODIFIERS.ctrl)
        );
      }
      if (modifier === 0) {
        return (
          matchesLegacySequence(data, LEGACY_SEQUENCES['right']!.plain) ||
          matchesKittySequence(data, ARROW_CODEPOINTS['right']!, 0)
        );
      }
      if (matchesLegacyModifierSequence(data, 'right', modifier)) return true;
      return matchesKittySequence(data, ARROW_CODEPOINTS['right']!, modifier);

    case 'f1':
    case 'f2':
    case 'f3':
    case 'f4':
    case 'f5':
    case 'f6':
    case 'f7':
    case 'f8':
    case 'f9':
    case 'f10':
    case 'f11':
    case 'f12': {
      if (modifier !== 0) return false;
      return matchesLegacySequence(data, LEGACY_SEQUENCES[key]!.plain);
    }
  }

  // Handle single letter/digit keys and symbols
  if (key.length === 1 && ((key >= 'a' && key <= 'z') || isDigitKey(key) || SYMBOL_KEYS.has(key))) {
    const codepoint = key.charCodeAt(0);
    const rawCtrl = rawCtrlChar(key);
    const isLetter = key >= 'a' && key <= 'z';
    const isDigit = isDigitKey(key);

    if (ctrl && alt && !shift && !_kittyProtocolActive && rawCtrl) {
      return data === `\x1b${rawCtrl}`;
    }

    if (alt && !ctrl && !shift && !_kittyProtocolActive && (isLetter || isDigit)) {
      if (data === `\x1b${key}`) return true;
    }

    if (ctrl && !shift && !alt) {
      if (rawCtrl && data === rawCtrl) return true;
      return (
        matchesKittySequence(data, codepoint, MODIFIERS.ctrl) ||
        matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.ctrl)
      );
    }

    if (ctrl && shift && !alt) {
      return (
        matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl) ||
        matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl)
      );
    }

    if (shift && !ctrl && !alt) {
      if (isLetter && data === key.toUpperCase()) return true;
      return (
        matchesKittySequence(data, codepoint, MODIFIERS.shift) ||
        matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift)
      );
    }

    if (modifier !== 0) {
      return (
        matchesKittySequence(data, codepoint, modifier) ||
        matchesPrintableModifyOtherKeys(data, codepoint, modifier)
      );
    }

    return data === key || matchesKittySequence(data, codepoint, 0);
  }

  return false;
}

/**
 * Parse input data and return the key identifier if recognized.
 */
function formatParsedKey(codepoint: number, modifier: number, baseLayoutKey?: number): KeyId | undefined {
  const isLatinLetter = codepoint >= 97 && codepoint <= 122; // a-z
  const isDigit = codepoint >= 48 && codepoint <= 57; // 0-9
  const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(codepoint));
  const effectiveCodepoint = isLatinLetter || isDigit || isKnownSymbol ? codepoint : (baseLayoutKey ?? codepoint);

  let keyName: string | undefined;
  if (effectiveCodepoint === CODEPOINTS.escape) keyName = 'escape';
  else if (effectiveCodepoint === CODEPOINTS.tab) keyName = 'tab';
  else if (effectiveCodepoint === CODEPOINTS.enter || effectiveCodepoint === CODEPOINTS.kpEnter) keyName = 'enter';
  else if (effectiveCodepoint === CODEPOINTS.space) keyName = 'space';
  else if (effectiveCodepoint === CODEPOINTS.backspace) keyName = 'backspace';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['delete']) keyName = 'delete';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['insert']) keyName = 'insert';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['home']) keyName = 'home';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['end']) keyName = 'end';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['pageUp']) keyName = 'pageUp';
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS['pageDown']) keyName = 'pageDown';
  else if (effectiveCodepoint === ARROW_CODEPOINTS['up']) keyName = 'up';
  else if (effectiveCodepoint === ARROW_CODEPOINTS['down']) keyName = 'down';
  else if (effectiveCodepoint === ARROW_CODEPOINTS['left']) keyName = 'left';
  else if (effectiveCodepoint === ARROW_CODEPOINTS['right']) keyName = 'right';
  else if (effectiveCodepoint >= 48 && effectiveCodepoint <= 57) keyName = String.fromCharCode(effectiveCodepoint);
  else if (effectiveCodepoint >= 97 && effectiveCodepoint <= 122) keyName = String.fromCharCode(effectiveCodepoint);
  else if (SYMBOL_KEYS.has(String.fromCharCode(effectiveCodepoint))) keyName = String.fromCharCode(effectiveCodepoint);

  if (!keyName) return undefined;
  return formatKeyNameWithModifiers(keyName, modifier);
}

export function parseKey(data: string): KeyId | undefined {
  const kitty = parseKittySequence(data);
  if (kitty) {
    return formatParsedKey(kitty.codepoint, kitty.modifier, kitty.baseLayoutKey);
  }

  const modifyOtherKeys = parseModifyOtherKeysSequence(data);
  if (modifyOtherKeys) {
    return formatParsedKey(modifyOtherKeys.codepoint, modifyOtherKeys.modifier);
  }

  // Mode-aware legacy sequences
  if (_kittyProtocolActive) {
    if (data === '\x1b\r' || data === '\n') return 'shift+enter';
  }

  const legacySequenceKeyId = LEGACY_SEQUENCE_KEY_IDS[data];
  if (legacySequenceKeyId) return legacySequenceKeyId;

  // Legacy sequences
  if (data === '\x1b') return 'escape';
  if (data === '\x1c') return 'ctrl+\\';
  if (data === '\x1d') return 'ctrl+]';
  if (data === '\x1f') return 'ctrl+-';
  if (data === '\x1b\x1b') return 'ctrl+alt+[';
  if (data === '\x1b\x1c') return 'ctrl+alt+\\';
  if (data === '\x1b\x1d') return 'ctrl+alt+]';
  if (data === '\x1b\x1f') return 'ctrl+alt+-';
  if (data === '\t') return 'tab';
  if (data === '\r' || (!_kittyProtocolActive && data === '\n') || data === '\x1bOM') return 'enter';
  if (data === '\x00') return 'ctrl+space';
  if (data === ' ') return 'space';
  if (data === '\x7f' || data === '\x08') return 'backspace';
  if (data === '\x1b[Z') return 'shift+tab';
  if (!_kittyProtocolActive && data === '\x1b\r') return 'alt+enter';
  if (!_kittyProtocolActive && data === '\x1b ') return 'alt+space';
  if (data === '\x1b\x7f' || data === '\x1b\b') return 'alt+backspace';
  if (!_kittyProtocolActive && data === '\x1bB') return 'alt+left';
  if (!_kittyProtocolActive && data === '\x1bF') return 'alt+right';

  if (!_kittyProtocolActive && data.length === 2 && data[0] === '\x1b') {
    const code = data.charCodeAt(1);
    if (code >= 1 && code <= 26) {
      return `ctrl+alt+${String.fromCharCode(code + 96)}`;
    }
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      return `alt+${String.fromCharCode(code)}`;
    }
  }

  if (data === '\x1b[A') return 'up';
  if (data === '\x1b[B') return 'down';
  if (data === '\x1b[C') return 'right';
  if (data === '\x1b[D') return 'left';
  if (data === '\x1b[H' || data === '\x1bOH') return 'home';
  if (data === '\x1b[F' || data === '\x1bOF') return 'end';
  if (data === '\x1b[3~') return 'delete';
  if (data === '\x1b[5~') return 'pageUp';
  if (data === '\x1b[6~') return 'pageDown';

  // Raw Ctrl+letter
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 96)}`;
    }
    if (code >= 32 && code <= 126) {
      return data;
    }
  }

  return undefined;
}

// =============================================================================
// Kitty CSI-u Printable Decoding
// =============================================================================

const KITTY_CSI_U_REGEX = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/;
const KITTY_PRINTABLE_ALLOWED_MODIFIERS = MODIFIERS.shift | LOCK_MASK;

/**
 * Decode a Kitty CSI-u sequence into a printable character, if applicable.
 *
 * When Kitty keyboard protocol flag 1 (disambiguate) is active, terminals send
 * CSI-u sequences for all keys, including plain printable characters. This
 * function extracts the printable character from such sequences.
 *
 * Only accepts plain or Shift-modified keys. Rejects Ctrl, Alt, and unsupported
 * modifier combinations.
 */
export function decodeKittyPrintable(data: string): string | undefined {
  const match = data.match(KITTY_CSI_U_REGEX);
  if (!match) return undefined;

  const codepoint = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(codepoint)) return undefined;

  const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : undefined;
  const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;

  const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;

  if ((modifier & ~KITTY_PRINTABLE_ALLOWED_MODIFIERS) !== 0) return undefined;
  if (modifier & (MODIFIERS.alt | MODIFIERS.ctrl)) return undefined;

  let effectiveCodepoint = codepoint;
  if (modifier & MODIFIERS.shift && typeof shiftedKey === 'number') {
    effectiveCodepoint = shiftedKey;
  }

  if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return undefined;

  try {
    return String.fromCodePoint(effectiveCodepoint);
  } catch {
    return undefined;
  }
}

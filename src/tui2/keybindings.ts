/**
 * Editor keybinding management.
 *
 * Provides default keybindings for editor actions and a manager class
 * that supports user-configurable overrides.
 */

import { matchesKey } from './keys.js';
import type { KeyId } from './keys.js';

/** A keybinding value — single key or array of alternatives */
export type KeyBinding = KeyId | KeyId[];

/** Map of action names to their key bindings */
export type KeybindingConfig = Record<string, KeyBinding | undefined>;

/**
 * Default editor keybindings.
 */
export const DEFAULT_EDITOR_KEYBINDINGS: Record<string, KeyBinding> = {
  // Cursor movement
  cursorUp: 'up',
  cursorDown: 'down',
  cursorLeft: ['left', 'ctrl+b'],
  cursorRight: ['right', 'ctrl+f'],
  cursorWordLeft: ['alt+left', 'ctrl+left', 'alt+b'],
  cursorWordRight: ['alt+right', 'ctrl+right', 'alt+f'],
  cursorLineStart: ['home', 'ctrl+a'],
  cursorLineEnd: ['end', 'ctrl+e'],
  jumpForward: 'ctrl+]',
  jumpBackward: 'ctrl+alt+]',
  pageUp: 'pageUp',
  pageDown: 'pageDown',

  // Deletion
  deleteCharBackward: 'backspace',
  deleteCharForward: ['delete', 'ctrl+d'],
  deleteWordBackward: ['ctrl+w', 'alt+backspace'],
  deleteWordForward: ['alt+d', 'alt+delete'],
  deleteToLineStart: 'ctrl+u',
  deleteToLineEnd: 'ctrl+k',

  // Text input
  newLine: 'shift+enter',
  submit: 'enter',
  tab: 'tab',

  // Selection/autocomplete
  selectUp: 'up',
  selectDown: 'down',
  selectPageUp: 'pageUp',
  selectPageDown: 'pageDown',
  selectConfirm: 'enter',
  selectCancel: ['escape', 'ctrl+c'],

  // Clipboard
  copy: 'ctrl+c',

  // Kill ring
  yank: 'ctrl+y',
  yankPop: 'alt+y',

  // Undo
  undo: 'ctrl+-',

  // Tool output
  expandTools: 'ctrl+o',

  // Tree navigation
  treeFoldOrUp: ['ctrl+left', 'alt+left'],
  treeUnfoldOrDown: ['ctrl+right', 'alt+right'],

  // Session
  toggleSessionPath: 'ctrl+p',
  toggleSessionSort: 'ctrl+s',
  renameSession: 'ctrl+r',
  deleteSession: 'ctrl+d',
  deleteSessionNoninvasive: 'ctrl+backspace',
};

/**
 * Manages keybindings for the editor.
 */
export class EditorKeybindingsManager {
  private actionToKeys: Map<string, KeyId[]> = new Map();

  constructor(config: KeybindingConfig = {}) {
    this.buildMaps(config);
  }

  private buildMaps(config: KeybindingConfig): void {
    this.actionToKeys.clear();

    // Start with defaults
    for (const [action, keys] of Object.entries(DEFAULT_EDITOR_KEYBINDINGS)) {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      this.actionToKeys.set(action, [...keyArray]);
    }

    // Override with user config
    for (const [action, keys] of Object.entries(config)) {
      if (keys === undefined) continue;
      const keyArray = Array.isArray(keys) ? keys : [keys];
      this.actionToKeys.set(action, keyArray);
    }
  }

  /**
   * Check if input matches a specific action.
   */
  matches(data: string, action: string): boolean {
    const keys = this.actionToKeys.get(action);
    if (!keys) return false;
    for (const key of keys) {
      if (matchesKey(data, key)) return true;
    }
    return false;
  }

  /**
   * Get keys bound to an action.
   */
  getKeys(action: string): KeyId[] {
    return this.actionToKeys.get(action) ?? [];
  }

  /**
   * Update configuration.
   */
  setConfig(config: KeybindingConfig): void {
    this.buildMaps(config);
  }
}

// Global instance
let globalEditorKeybindings: EditorKeybindingsManager | null = null;

export function getEditorKeybindings(): EditorKeybindingsManager {
  if (!globalEditorKeybindings) {
    globalEditorKeybindings = new EditorKeybindingsManager();
  }
  return globalEditorKeybindings;
}

export function setEditorKeybindings(manager: EditorKeybindingsManager): void {
  globalEditorKeybindings = manager;
}

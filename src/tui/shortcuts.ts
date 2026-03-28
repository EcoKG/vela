import type Database from 'better-sqlite3';
import { listSessions } from '../session.js';
import type { ChatSession } from '../session.js';
import { resolveModelAlias } from '../models.js';

// ── Shortcut key definitions ───────────────────────────────────────

export interface ShortcutDef {
  keys: string;
  description: string;
}

/**
 * Typed map of keyboard shortcut definitions for the TUI.
 * Keys use Ink's useInput convention.
 */
export const SHORTCUTS = {
  DASHBOARD_TOGGLE: { keys: 'Ctrl+D', description: 'Toggle dashboard' },
  CLEAR_MESSAGES: { keys: 'Ctrl+L', description: 'Clear messages' },
  DISMISS: { keys: 'Escape', description: 'Dismiss help overlay' },
} as const satisfies Record<string, ShortcutDef>;

/**
 * Flat array of shortcut info for HelpOverlay display.
 */
export const SHORTCUT_LIST: ShortcutDef[] = [
  SHORTCUTS.DASHBOARD_TOGGLE,
  SHORTCUTS.CLEAR_MESSAGES,
  SHORTCUTS.DISMISS,
  { keys: '/', description: 'Slash commands (/help, /quit, /clear, /fresh, /sessions, /model, /budget, /auto)' },
];

// ── Slash command result types ─────────────────────────────────────

export type SlashCommandResult =
  | { action: 'help' }
  | { action: 'quit' }
  | { action: 'clear' }
  | { action: 'fresh' }
  | { action: 'sessions'; sessions: ChatSession[] }
  | { action: 'model'; model: string }
  | { action: 'model-switch'; model: string }
  | { action: 'budget-set'; amount: number }
  | { action: 'budget-status' }
  | { action: 'auto-toggle' }
  | { action: 'error'; message: string };

export interface SlashCommandContext {
  db: Database.Database | null;
  model: string;
}

// ── Slash command handler ──────────────────────────────────────────

/**
 * Parses slash-prefixed input and returns a typed result.
 * Returns `null` for non-slash input.
 *
 * Pure function — no side effects, no rendering.
 */
export function handleSlashCommand(
  input: string,
  context: SlashCommandContext,
): SlashCommandResult | null {
  const trimmed = input.trim();

  // Not a slash command
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const command = parts[0]!.toLowerCase();

  switch (command) {
    case '/help':
      return { action: 'help' };

    case '/quit':
      return { action: 'quit' };

    case '/clear':
      return { action: 'clear' };

    case '/fresh':
      return { action: 'fresh' };

    case '/sessions': {
      if (!context.db) {
        return { action: 'error', message: 'No session database available' };
      }
      const sessions = listSessions(context.db);
      return { action: 'sessions', sessions };
    }

    case '/model':
      if (parts.length > 1) {
        const resolved = resolveModelAlias(parts[1]!);
        return { action: 'model-switch', model: resolved };
      }
      return { action: 'model', model: context.model };

    case '/budget':
      if (parts.length > 1) {
        const raw = parts[1]!;
        const amount = parseFloat(raw);
        if (Number.isNaN(amount)) {
          return { action: 'error', message: 'Invalid budget amount' };
        }
        if (amount < 0) {
          return { action: 'error', message: 'Invalid budget amount' };
        }
        return { action: 'budget-set', amount };
      }
      return { action: 'budget-status' };

    case '/auto':
      return { action: 'auto-toggle' };

    default:
      return {
        action: 'error',
        message: `Unknown command: ${parts[0]}`,
      };
  }
}

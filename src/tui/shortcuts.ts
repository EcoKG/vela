import type Database from 'better-sqlite3';
import { listSessions } from '../session.js';
import type { ChatSession } from '../session.js';
import { resolveModelAlias } from '../models.js';

// ── Shortcut key definitions ───────────────────────────────────────

export interface ShortcutDef {
  keys: string;
  description: string;
}

export const SHORTCUTS = {
  DASHBOARD_TOGGLE: { keys: 'Ctrl+D', description: 'Toggle dashboard' },
  CLEAR_MESSAGES: { keys: 'Ctrl+L', description: 'Clear messages' },
  DISMISS: { keys: 'Escape', description: 'Dismiss help overlay' },
} as const satisfies Record<string, ShortcutDef>;

export const SHORTCUT_LIST: ShortcutDef[] = [
  SHORTCUTS.DASHBOARD_TOGGLE,
  SHORTCUTS.CLEAR_MESSAGES,
  SHORTCUTS.DISMISS,
  { keys: '/', description: 'Slash commands (/help, /quit, /clear, /fresh, /sessions, /model, /budget, /auto, /start, /state, /transition, /cancel)' },
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
  | { action: 'pipeline-start'; request: string; scale?: string; type?: string }
  | { action: 'pipeline-state' }
  | { action: 'pipeline-transition' }
  | { action: 'pipeline-cancel' }
  | { action: 'error'; message: string };

export interface SlashCommandContext {
  db: Database.Database | null;
  model: string;
}

// ── Slash command handler ──────────────────────────────────────────

export function handleSlashCommand(
  input: string,
  context: SlashCommandContext,
): SlashCommandResult | null {
  const trimmed = input.trim();
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

    // ── Pipeline commands ───────────────────────────────────────
    case '/start': {
      const rest = parts.slice(1).join(' ');
      if (!rest) {
        return { action: 'error', message: '/start <task> — task description required' };
      }
      // Parse optional flags
      let scale: string | undefined;
      let type: string | undefined;
      const flagRe = /--scale\s+(\S+)/i;
      const typeRe = /--type\s+(\S+)/i;
      const scaleMatch = rest.match(flagRe);
      const typeMatch = rest.match(typeRe);
      if (scaleMatch) scale = scaleMatch[1];
      if (typeMatch) type = typeMatch[1];
      const request = rest.replace(flagRe, '').replace(typeRe, '').trim();
      if (!request) {
        return { action: 'error', message: '/start <task> — task description required' };
      }
      return { action: 'pipeline-start', request, scale, type };
    }

    case '/state':
      return { action: 'pipeline-state' };

    case '/transition':
      return { action: 'pipeline-transition' };

    case '/cancel':
      return { action: 'pipeline-cancel' };

    default:
      return {
        action: 'error',
        message: `Unknown command: ${parts[0]}`,
      };
  }
}

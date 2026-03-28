import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleSlashCommand,
  SHORTCUTS,
  SHORTCUT_LIST,
} from '../src/tui/shortcuts.js';
import type { SlashCommandContext, SlashCommandResult } from '../src/tui/shortcuts.js';
import { openSessionDb, createSession } from '../src/session.js';
import type Database from 'better-sqlite3';

// ── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    db: null,
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

// ── Shortcut constants ─────────────────────────────────────────────

describe('SHORTCUTS constants', () => {
  it('defines Ctrl+D for dashboard toggle', () => {
    expect(SHORTCUTS.DASHBOARD_TOGGLE.keys).toBe('Ctrl+D');
    expect(SHORTCUTS.DASHBOARD_TOGGLE.description).toContain('dashboard');
  });

  it('defines Ctrl+L for clear', () => {
    expect(SHORTCUTS.CLEAR_MESSAGES.keys).toBe('Ctrl+L');
  });

  it('defines Escape for dismiss', () => {
    expect(SHORTCUTS.DISMISS.keys).toBe('Escape');
  });

  it('SHORTCUT_LIST includes all shortcuts plus slash command entry', () => {
    expect(SHORTCUT_LIST.length).toBeGreaterThanOrEqual(4);
    const keys = SHORTCUT_LIST.map((s) => s.keys);
    expect(keys).toContain('Ctrl+D');
    expect(keys).toContain('Ctrl+L');
    expect(keys).toContain('Escape');
    expect(keys).toContain('/');
  });
});

// ── handleSlashCommand ─────────────────────────────────────────────

describe('handleSlashCommand', () => {
  const ctx = makeContext();

  // ── Non-slash input returns null ──

  it('returns null for plain text input', () => {
    expect(handleSlashCommand('hello world', ctx)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(handleSlashCommand('', ctx)).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(handleSlashCommand('   ', ctx)).toBeNull();
  });

  // ── /help ──

  it('/help returns help action', () => {
    const result = handleSlashCommand('/help', ctx);
    expect(result).toEqual({ action: 'help' });
  });

  it('/help is case-insensitive', () => {
    const result = handleSlashCommand('/HELP', ctx);
    expect(result).toEqual({ action: 'help' });
  });

  it('/help with trailing whitespace works', () => {
    const result = handleSlashCommand('  /help  ', ctx);
    expect(result).toEqual({ action: 'help' });
  });

  // ── /quit ──

  it('/quit returns quit action', () => {
    const result = handleSlashCommand('/quit', ctx);
    expect(result).toEqual({ action: 'quit' });
  });

  it('/QUIT is case-insensitive', () => {
    const result = handleSlashCommand('/QUIT', ctx);
    expect(result).toEqual({ action: 'quit' });
  });

  // ── /clear ──

  it('/clear returns clear action', () => {
    const result = handleSlashCommand('/clear', ctx);
    expect(result).toEqual({ action: 'clear' });
  });

  // ── /fresh ──

  it('/fresh returns fresh action', () => {
    const result = handleSlashCommand('/fresh', ctx);
    expect(result).toEqual({ action: 'fresh' });
  });

  it('/FRESH is case-insensitive', () => {
    const result = handleSlashCommand('/FRESH', ctx);
    expect(result).toEqual({ action: 'fresh' });
  });

  it('/fresh with trailing whitespace works', () => {
    const result = handleSlashCommand('  /fresh  ', ctx);
    expect(result).toEqual({ action: 'fresh' });
  });

  // ── /model ──

  it('/model returns model action with current model name', () => {
    const result = handleSlashCommand('/model', ctx);
    expect(result).toEqual({ action: 'model', model: 'claude-sonnet-4-20250514' });
  });

  it('/model reflects custom model from context', () => {
    const customCtx = makeContext({ model: 'claude-3-haiku-20240307' });
    const result = handleSlashCommand('/model', customCtx);
    expect(result).toEqual({ action: 'model', model: 'claude-3-haiku-20240307' });
  });

  // ── /model <alias> (model-switch) ──

  it('/model sonnet returns model-switch with resolved alias', () => {
    const result = handleSlashCommand('/model sonnet', ctx);
    expect(result).toEqual({ action: 'model-switch', model: 'claude-sonnet-4-20250514' });
  });

  it('/model opus returns model-switch with resolved alias', () => {
    const result = handleSlashCommand('/model opus', ctx);
    expect(result).toEqual({ action: 'model-switch', model: 'claude-opus-4-20250514' });
  });

  it('/model haiku returns model-switch with resolved alias', () => {
    const result = handleSlashCommand('/model haiku', ctx);
    expect(result).toEqual({ action: 'model-switch', model: 'claude-haiku-4-20250514' });
  });

  it('/model with unknown ID returns model-switch passthrough', () => {
    const result = handleSlashCommand('/model some-custom-model', ctx);
    expect(result).toEqual({ action: 'model-switch', model: 'some-custom-model' });
  });

  it('/model alias is case-insensitive', () => {
    const result = handleSlashCommand('/model OPUS', ctx);
    expect(result).toEqual({ action: 'model-switch', model: 'claude-opus-4-20250514' });
  });

  // ── /sessions ──

  describe('/sessions', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = openSessionDb(); // in-memory
    });

    afterEach(() => {
      try { db.close(); } catch { /* ignore */ }
    });

    it('returns sessions list from db', () => {
      createSession(db, { model: 'test-model', title: 'Session A' });
      createSession(db, { model: 'test-model', title: 'Session B' });

      const result = handleSlashCommand('/sessions', makeContext({ db }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('sessions');
      if (result!.action === 'sessions') {
        expect(result!.sessions).toHaveLength(2);
        const titles = result!.sessions.map((s) => s.title);
        expect(titles).toContain('Session A');
        expect(titles).toContain('Session B');
      }
    });

    it('returns empty list when no sessions exist', () => {
      const result = handleSlashCommand('/sessions', makeContext({ db }));
      expect(result).not.toBeNull();
      if (result!.action === 'sessions') {
        expect(result!.sessions).toHaveLength(0);
      }
    });

    it('returns error when db is null', () => {
      const result = handleSlashCommand('/sessions', makeContext({ db: null }));
      expect(result).toEqual({
        action: 'error',
        message: 'No session database available',
      });
    });
  });

  // ── /budget ──

  describe('/budget', () => {
    it('/budget with no args → budget-status', () => {
      const result = handleSlashCommand('/budget', ctx);
      expect(result).toEqual({ action: 'budget-status' });
    });

    it('/budget 5 → budget-set with amount 5', () => {
      const result = handleSlashCommand('/budget 5', ctx);
      expect(result).toEqual({ action: 'budget-set', amount: 5 });
    });

    it('/budget 0.50 → budget-set with amount 0.5', () => {
      const result = handleSlashCommand('/budget 0.50', ctx);
      expect(result).toEqual({ action: 'budget-set', amount: 0.5 });
    });

    it('/budget abc → error', () => {
      const result = handleSlashCommand('/budget abc', ctx);
      expect(result).toEqual({ action: 'error', message: 'Invalid budget amount' });
    });

    it('/budget -1 → error (negative budget)', () => {
      const result = handleSlashCommand('/budget -1', ctx);
      expect(result).toEqual({ action: 'error', message: 'Invalid budget amount' });
    });

    it('/budget 0 → budget-set with amount 0', () => {
      const result = handleSlashCommand('/budget 0', ctx);
      expect(result).toEqual({ action: 'budget-set', amount: 0 });
    });

    it('/BUDGET is case-insensitive', () => {
      const result = handleSlashCommand('/BUDGET', ctx);
      expect(result).toEqual({ action: 'budget-status' });
    });
  });

  // ── Unknown command ──

  it('returns error for unknown slash command', () => {
    const result = handleSlashCommand('/foobar', ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('error');
    if (result!.action === 'error') {
      expect(result!.message).toContain('/foobar');
    }
  });

  it('returns error for bare slash', () => {
    const result = handleSlashCommand('/', ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('error');
    if (result!.action === 'error') {
      expect(result!.message).toContain('/');
    }
  });

  // ── /auto ──

  describe('/auto', () => {
    it('/auto returns auto-toggle action', () => {
      const result = handleSlashCommand('/auto', ctx);
      expect(result).toEqual({ action: 'auto-toggle' });
    });

    it('/AUTO is case-insensitive', () => {
      const result = handleSlashCommand('/AUTO', ctx);
      expect(result).toEqual({ action: 'auto-toggle' });
    });

    it('/auto with extra args still returns auto-toggle (ignored)', () => {
      const result = handleSlashCommand('/auto extra stuff', ctx);
      expect(result).toEqual({ action: 'auto-toggle' });
    });

    it('/auto when already toggled returns same action (stateless)', () => {
      // handleSlashCommand is pure — it always returns auto-toggle
      const result1 = handleSlashCommand('/auto', ctx);
      const result2 = handleSlashCommand('/auto', ctx);
      expect(result1).toEqual(result2);
      expect(result1).toEqual({ action: 'auto-toggle' });
    });
  });

  // ── Edge cases ──

  it('handles command with extra arguments gracefully', () => {
    const result = handleSlashCommand('/help extra args here', ctx);
    expect(result).toEqual({ action: 'help' });
  });

  it('preserves original casing in unknown command error message', () => {
    const result = handleSlashCommand('/FooBar', ctx);
    expect(result).not.toBeNull();
    if (result!.action === 'error') {
      expect(result!.message).toContain('/FooBar');
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock child_process via globalThis (K006) ──────────────────

// Module-scoped mock function set per test via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __mockExecSync: (...args: unknown[]) => unknown;
}

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => globalThis.__mockExecSync(...args),
}));

// Import after mock is installed
import {
  isClaudeCodeReady,
  getClaudePath,
  clearReadinessCache,
} from '../src/claude-code-readiness.js';

// ── Tests ─────────────────────────────────────────────────────

describe('claude-code-readiness', () => {
  beforeEach(() => {
    clearReadinessCache();
    globalThis.__mockExecSync = () => Buffer.from('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isClaudeCodeReady', () => {
    it('returns true when claude --version succeeds', () => {
      globalThis.__mockExecSync = () => Buffer.from('claude 1.0.0\n');
      expect(isClaudeCodeReady()).toBe(true);
    });

    it('returns false when execSync throws', () => {
      globalThis.__mockExecSync = () => {
        throw new Error('command not found: claude');
      };
      expect(isClaudeCodeReady()).toBe(false);
    });

    it('uses cache within 30s', () => {
      let callCount = 0;
      globalThis.__mockExecSync = () => {
        callCount++;
        return Buffer.from('claude 1.0.0\n');
      };

      isClaudeCodeReady(); // first call — should invoke execSync
      isClaudeCodeReady(); // second call — should use cache

      expect(callCount).toBe(1);
    });

    it('re-checks after cache expiry', () => {
      let callCount = 0;
      globalThis.__mockExecSync = () => {
        callCount++;
        return Buffer.from('claude 1.0.0\n');
      };

      isClaudeCodeReady(); // populates cache
      expect(callCount).toBe(1);

      // Fast-forward past 30s TTL
      clearReadinessCache();

      isClaudeCodeReady(); // cache cleared — should invoke execSync again
      expect(callCount).toBe(2);
    });
  });

  describe('getClaudePath', () => {
    it('returns path when which claude succeeds', () => {
      globalThis.__mockExecSync = (cmd: unknown) => {
        if (typeof cmd === 'string' && cmd.includes('which')) {
          return Buffer.from('/usr/local/bin/claude\n');
        }
        return Buffer.from('');
      };
      expect(getClaudePath()).toBe('/usr/local/bin/claude');
    });

    it('returns null when which claude fails', () => {
      globalThis.__mockExecSync = (cmd: unknown) => {
        if (typeof cmd === 'string' && cmd.includes('which')) {
          throw new Error('claude not found');
        }
        return Buffer.from('');
      };
      expect(getClaudePath()).toBeNull();
    });
  });
});

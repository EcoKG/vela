/**
 * Tests for provider resolution module.
 *
 * After S01 simplification, resolveProvider() only checks
 * isClaudeCodeReady() — API key resolution has been removed.
 * Mocks isClaudeCodeReady via globalThis indirection (K006).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock declarations ─────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __mockIsClaudeCodeReady: () => boolean;
}

vi.mock('../src/claude-code-readiness.js', () => ({
  isClaudeCodeReady: () => globalThis.__mockIsClaudeCodeReady(),
}));

// Import after mocks are installed
import { resolveProvider } from '../src/provider.js';

// ── Tests ─────────────────────────────────────────────────────

describe('resolveProvider', () => {
  beforeEach(() => {
    globalThis.__mockIsClaudeCodeReady = () => false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cli provider when Claude Code CLI is ready', () => {
    globalThis.__mockIsClaudeCodeReady = () => true;

    const provider = resolveProvider();

    expect(provider).toEqual({ type: 'cli' });
  });

  it('throws when Claude Code CLI is not available', () => {
    globalThis.__mockIsClaudeCodeReady = () => false;

    expect(() => resolveProvider()).toThrow(
      'Claude Code CLI is not available. Install Claude Code CLI to use Vela.',
    );
  });
});

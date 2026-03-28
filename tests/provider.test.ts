/**
 * Tests for provider resolution module.
 *
 * Mocks resolveApiKey and isClaudeCodeReady via globalThis
 * indirection (K006 ESM mock pattern).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock declarations ─────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __mockResolveApiKey: () => string | null;
  // eslint-disable-next-line no-var
  var __mockIsClaudeCodeReady: () => boolean;
}

vi.mock('../src/auth.js', () => ({
  resolveApiKey: () => globalThis.__mockResolveApiKey(),
}));

vi.mock('../src/claude-code-readiness.js', () => ({
  isClaudeCodeReady: () => globalThis.__mockIsClaudeCodeReady(),
}));

// Import after mocks are installed
import { resolveProvider } from '../src/provider.js';

// ── Tests ─────────────────────────────────────────────────────

describe('resolveProvider', () => {
  beforeEach(() => {
    globalThis.__mockResolveApiKey = () => null;
    globalThis.__mockIsClaudeCodeReady = () => false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns api provider when API key is present', () => {
    globalThis.__mockResolveApiKey = () => 'sk-test-key-123';

    const provider = resolveProvider();

    expect(provider).toEqual({ type: 'api', apiKey: 'sk-test-key-123' });
  });

  it('returns cli provider when no API key but CLI is ready', () => {
    globalThis.__mockResolveApiKey = () => null;
    globalThis.__mockIsClaudeCodeReady = () => true;

    const provider = resolveProvider();

    expect(provider).toEqual({ type: 'cli' });
  });

  it('throws when neither API key nor CLI is available', () => {
    globalThis.__mockResolveApiKey = () => null;
    globalThis.__mockIsClaudeCodeReady = () => false;

    expect(() => resolveProvider()).toThrow(
      'No API key found and Claude Code CLI is not available. Set ANTHROPIC_API_KEY or install Claude Code CLI.',
    );
  });

  it('prioritizes API key even when CLI is also ready', () => {
    globalThis.__mockResolveApiKey = () => 'sk-both-available';
    globalThis.__mockIsClaudeCodeReady = () => true;

    const provider = resolveProvider();

    expect(provider).toEqual({ type: 'api', apiKey: 'sk-both-available' });
  });
});

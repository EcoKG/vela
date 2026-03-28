/**
 * Provider resolution module.
 *
 * Determines the best available provider for chat:
 *   1. API key via resolveApiKey() → { type: 'api', apiKey }
 *   2. Claude Code CLI via isClaudeCodeReady() → { type: 'cli' }
 *   3. Throws if neither is available
 */
import { resolveApiKey } from './auth.js';
import { isClaudeCodeReady } from './claude-code-readiness.js';

// ─── Types ─────────────────────────────────────────────────

/** API key provider — direct Anthropic API access */
export interface ApiProvider {
  type: 'api';
  apiKey: string;
}

/** CLI provider — delegates to Claude Code CLI */
export interface CliProvider {
  type: 'cli';
}

/** Discriminated union of available providers */
export type Provider = ApiProvider | CliProvider;

// ─── Public API ────────────────────────────────────────────

/**
 * Resolves the best available provider.
 *
 * Priority:
 *   1. API key (env var or profile) → ApiProvider
 *   2. Claude Code CLI installed → CliProvider
 *   3. Throws with a descriptive message
 */
export function resolveProvider(): Provider {
  const apiKey = resolveApiKey();
  if (apiKey) {
    return { type: 'api', apiKey };
  }

  if (isClaudeCodeReady()) {
    return { type: 'cli' };
  }

  throw new Error(
    'No API key found and Claude Code CLI is not available. Set ANTHROPIC_API_KEY or install Claude Code CLI.',
  );
}

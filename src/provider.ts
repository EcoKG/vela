/**
 * Provider resolution module.
 *
 * Returns a CLI provider backed by Claude Code CLI.
 * The API provider path has been removed — all communication
 * goes through the Claude Code CLI SDK via llm.ts.
 *
 * The ApiProvider type is kept as an export for backward compatibility
 * with consumers that reference Provider union type checks
 * (cli.ts, ChatApp.tsx). Those `type === 'api'` branches are now
 * dead code that will be removed in a future cleanup slice.
 */
import { isClaudeCodeReady } from './claude-code-readiness.js';

// ─── Types ─────────────────────────────────────────────────

/** @deprecated API provider path removed — kept for type compatibility */
export interface ApiProvider {
  type: 'api';
  apiKey: string;
}

/** CLI provider — delegates to Claude Code CLI */
export interface CliProvider {
  type: 'cli';
}

/**
 * Provider type.
 *
 * In practice only CliProvider is returned by `resolveProvider()`.
 * ApiProvider is retained in the union so downstream type checks
 * (`provider.type === 'api'`) continue to compile.
 */
export type Provider = ApiProvider | CliProvider;

// ─── Public API ────────────────────────────────────────────

/**
 * Resolves the available provider.
 *
 * Returns a CLI provider when Claude Code is ready.
 * Throws if Claude Code CLI is not available.
 */
export function resolveProvider(): Provider {
  if (isClaudeCodeReady()) {
    return { type: 'cli' };
  }

  throw new Error(
    'Claude Code CLI is not available. Install Claude Code CLI to use Vela.',
  );
}

/**
 * Model alias resolution for Vela.
 *
 * Maps short aliases (sonnet, opus, haiku) to full Claude model IDs.
 * Used by CLI --model flag and TUI /model command for ergonomic switching.
 */

// ── Constants ─────────────────────────────────────────────────

/** Default model ID used when no model is specified. */
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Short alias → full model ID mapping.
 * Keys are lowercase; lookup is case-insensitive via resolveModelAlias().
 */
export const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-20250514',
};

/**
 * Complexity tier → model ID mapping for auto-routing.
 * Used by model-router to select the optimal model for a given message.
 */
export const MODEL_TIERS: Record<string, string> = {
  simple: 'claude-haiku-4-20250514',
  moderate: 'claude-sonnet-4-20250514',
  complex: 'claude-opus-4-20250514',
};

/**
 * Set of all known full model IDs.
 * Used to validate whether a string is already a recognised model.
 */
export const KNOWN_MODELS: ReadonlySet<string> = new Set([
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-20250514',
]);

// ── Resolution ────────────────────────────────────────────────

/**
 * Resolves a user-provided model string to a full model ID.
 *
 * Resolution order:
 *  1. If the input matches a known alias (case-insensitive), return the mapped ID.
 *  2. Otherwise, return the input unchanged (passthrough for full model IDs
 *     or unknown models — validation happens downstream).
 *
 * @example
 *   resolveModelAlias('sonnet')   // → 'claude-sonnet-4-20250514'
 *   resolveModelAlias('OPUS')     // → 'claude-opus-4-20250514'
 *   resolveModelAlias('claude-sonnet-4-20250514') // → 'claude-sonnet-4-20250514' (passthrough)
 *   resolveModelAlias('gpt-4o')   // → 'gpt-4o' (unknown passthrough)
 */
export function resolveModelAlias(input: string): string {
  const normalised = input.trim().toLowerCase();
  return MODEL_ALIASES[normalised] ?? input.trim();
}

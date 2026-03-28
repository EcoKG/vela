/**
 * Token usage tracker and cost calculator for Vela.
 *
 * Accumulates token counts across multiple turns and computes estimated
 * cost based on a static model pricing table. Pricing is approximate and
 * sourced from Anthropic's public pricing page (March 2026).
 */

// ── Model pricing table ───────────────────────────────────────
// Prices per million tokens (USD). Pricing as of March 2026.
// Keys are model ID prefixes — date suffixes are stripped before lookup.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4':  { inputPerMTok: 3,  outputPerMTok: 15 },
  'claude-haiku-4':   { inputPerMTok: 1,  outputPerMTok: 5  },
  'claude-opus-4':    { inputPerMTok: 5,  outputPerMTok: 25 },
};

// ── Types ─────────────────────────────────────────────────────

export interface TokenState {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface UsageDelta {
  input_tokens: number;
  output_tokens: number;
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Strips the date suffix from a model ID and finds the longest matching
 * prefix in the pricing table.
 *
 * Examples:
 *   "claude-sonnet-4-20250514" → "claude-sonnet-4"
 *   "claude-haiku-4-20250514"  → "claude-haiku-4"
 *   "unknown-model"            → undefined
 */
export function resolveModelPrefix(model: string): string | undefined {
  // Sort keys by length descending so longest prefix matches first
  const sortedKeys = Object.keys(MODEL_PRICING).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of sortedKeys) {
    if (model.startsWith(key)) {
      return key;
    }
  }
  return undefined;
}

// ── TokenTracker class ────────────────────────────────────────

export class TokenTracker {
  private inputTokens = 0;
  private outputTokens = 0;

  /**
   * Add usage from one API response. Accumulates totals across calls.
   */
  addUsage(usage: UsageDelta): void {
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
  }

  /**
   * Returns accumulated token counts.
   */
  getState(): TokenState {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
    };
  }

  /**
   * Computes estimated cost in USD for the accumulated tokens.
   * Returns zeros for unknown models.
   */
  getCost(model: string): CostEstimate {
    const prefix = resolveModelPrefix(model);
    if (!prefix) {
      return { inputCost: 0, outputCost: 0, totalCost: 0 };
    }

    const pricing = MODEL_PRICING[prefix];
    const inputCost = (this.inputTokens / 1_000_000) * pricing.inputPerMTok;
    const outputCost = (this.outputTokens / 1_000_000) * pricing.outputPerMTok;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  /**
   * Resets all counters to zero.
   */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}

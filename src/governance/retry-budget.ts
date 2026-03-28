/**
 * Vela Retry Budget
 * Tracks consecutive gate blocks per gate code. When any single code
 * reaches the budget limit, the agent should terminate the current loop.
 *
 * Pure state — no I/O, no side effects.
 */

export const DEFAULT_RETRY_BUDGET = 3;

export class RetryBudget {
  private readonly limit: number;
  private readonly counts: Map<string, number> = new Map();

  constructor(limit: number = DEFAULT_RETRY_BUDGET) {
    this.limit = limit;
  }

  /**
   * Record a consecutive block for a gate code.
   * Increments the consecutive count for this specific code.
   */
  recordBlock(gateCode: string): void {
    const current = this.counts.get(gateCode) ?? 0;
    this.counts.set(gateCode, current + 1);
  }

  /**
   * Record a successful tool execution.
   * Resets all consecutive counts.
   */
  recordSuccess(): void {
    this.counts.clear();
  }

  /**
   * Check if any gate code has reached the budget limit.
   * Returns { terminate: true, gateCode, count } if so.
   */
  shouldTerminate(): { terminate: boolean; gateCode?: string; count?: number } {
    for (const [gateCode, count] of this.counts) {
      if (count >= this.limit) {
        return { terminate: true, gateCode, count };
      }
    }
    return { terminate: false };
  }
}

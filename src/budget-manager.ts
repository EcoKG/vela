/**
 * Session budget manager for Vela.
 *
 * Tracks spending against an optional USD budget limit.
 * Pure logic — no side effects, no TUI rendering.
 */

// ── Constants ─────────────────────────────────────────────────

/** Fraction of budget at which a warning is emitted (80%). */
export const WARNING_THRESHOLD = 0.8;

// ── Types ─────────────────────────────────────────────────────

export interface BudgetStatus {
  /** Budget limit in USD, or null if no budget is set. */
  limit: number | null;
  /** Total spent so far in USD. */
  spent: number;
  /** Remaining budget in USD (Infinity when no limit). */
  remaining: number;
  /** Fraction of budget consumed (0–1+). 0 when no limit. */
  percentage: number;
  /** True when spending is at or above WARNING_THRESHOLD but not yet blocked. */
  warning: boolean;
  /** True when spending has reached or exceeded the limit. */
  blocked: boolean;
}

// ── BudgetManager ─────────────────────────────────────────────

export class BudgetManager {
  private limit: number | null = null;
  private lastStatus: BudgetStatus = BudgetManager.neutralStatus();

  /**
   * Returns a neutral status for when no budget is set.
   */
  private static neutralStatus(): BudgetStatus {
    return {
      limit: null,
      spent: 0,
      remaining: Infinity,
      percentage: 0,
      warning: false,
      blocked: false,
    };
  }

  /**
   * Set or clear the session budget limit.
   * Pass `null` to clear the budget (no limit).
   */
  setBudget(limit: number | null): void {
    this.limit = limit;
    // Recompute status with the last known spent value
    this.lastStatus = this.computeStatus(this.lastStatus.spent);
  }

  /**
   * Check spending against the budget and return current status.
   * The `currentCost` is the cumulative session cost so far.
   */
  checkBudget(currentCost: number): BudgetStatus {
    this.lastStatus = this.computeStatus(currentCost);
    return this.lastStatus;
  }

  /**
   * Returns the last computed budget status without updating spent.
   */
  getStatus(): BudgetStatus {
    return this.lastStatus;
  }

  /**
   * Pure computation of budget status from spent amount.
   */
  private computeStatus(spent: number): BudgetStatus {
    if (this.limit === null) {
      return {
        limit: null,
        spent,
        remaining: Infinity,
        percentage: 0,
        warning: false,
        blocked: false,
      };
    }

    const remaining = this.limit - spent;
    const percentage = this.limit === 0 ? (spent > 0 ? 1 : 1) : spent / this.limit;
    const blocked = spent >= this.limit;
    const warning = percentage >= WARNING_THRESHOLD;

    return {
      limit: this.limit,
      spent,
      remaining,
      percentage,
      warning,
      blocked,
    };
  }
}

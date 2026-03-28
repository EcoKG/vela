/**
 * Retry Budget — Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { RetryBudget, DEFAULT_RETRY_BUDGET } from '../../src/governance/retry-budget.js';

describe('RetryBudget', () => {
  it('DEFAULT_RETRY_BUDGET is 3', () => {
    expect(DEFAULT_RETRY_BUDGET).toBe(3);
  });

  it('fresh budget shouldTerminate returns false', () => {
    const budget = new RetryBudget();
    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });

  it('3 consecutive blocks on same code triggers terminate', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');

    const result = budget.shouldTerminate();
    expect(result.terminate).toBe(true);
    expect(result.gateCode).toBe('VK-04');
    expect(result.count).toBe(3);
  });

  it('2 blocks does not trigger terminate with default budget', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');

    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });

  it('recordSuccess resets all counters', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');
    budget.recordSuccess();

    // After reset, no gate should trigger
    expect(budget.shouldTerminate()).toEqual({ terminate: false });

    // Even blocking same code again should start from 0
    budget.recordBlock('VK-04');
    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });

  it('different gate codes tracked independently', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-06');
    budget.recordBlock('VK-06');

    // Neither has reached 3
    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });

  it('mixed blocks on different codes dont trigger (VK-04, VK-06, VK-04 = only 2 consecutive VK-04)', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-06');
    budget.recordBlock('VK-04');

    // VK-04 has count 2 (non-consecutive doesn't matter — we count per-code total)
    // VK-06 has count 1
    // Actually the implementation just counts per-code, so VK-04 = 2, VK-06 = 1
    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });

  it('custom limit works', () => {
    const budget = new RetryBudget(1);
    budget.recordBlock('VG-02');

    const result = budget.shouldTerminate();
    expect(result.terminate).toBe(true);
    expect(result.gateCode).toBe('VG-02');
    expect(result.count).toBe(1);
  });

  it('custom limit of 5 requires 5 blocks', () => {
    const budget = new RetryBudget(5);
    for (let i = 0; i < 4; i++) {
      budget.recordBlock('VK-04');
    }
    expect(budget.shouldTerminate()).toEqual({ terminate: false });

    budget.recordBlock('VK-04');
    const result = budget.shouldTerminate();
    expect(result.terminate).toBe(true);
    expect(result.count).toBe(5);
  });

  it('recordSuccess after blocks then new blocks work correctly', () => {
    const budget = new RetryBudget();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');
    budget.recordSuccess();
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');

    // After success reset, only 2 new blocks — under limit
    expect(budget.shouldTerminate()).toEqual({ terminate: false });
  });
});

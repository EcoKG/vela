import { describe, it, expect } from 'vitest';
import { classifyComplexity, selectModel } from '../src/model-router.js';
import type { BudgetStatus } from '../src/budget-manager.js';
import { MODEL_TIERS } from '../src/models.js';

// ── Helpers ──────────────────────────────────────────────────

/** Budget with no limit set (normal spending, no pressure). */
function noBudget(spent = 0): BudgetStatus {
  return {
    limit: null,
    spent,
    remaining: Infinity,
    percentage: 0,
    warning: false,
    blocked: false,
  };
}

/** Budget with a limit and computed fields. */
function budgetAt(spent: number, limit: number): BudgetStatus {
  const percentage = limit === 0 ? 1 : spent / limit;
  return {
    limit,
    spent,
    remaining: limit - spent,
    percentage,
    warning: percentage >= 0.8,
    blocked: spent >= limit,
  };
}

// ── classifyComplexity ───────────────────────────────────────

describe('classifyComplexity', () => {
  it('classifies a short simple message as simple', () => {
    expect(classifyComplexity('Hello, how are you?')).toBe('simple');
  });

  it('classifies empty string as simple', () => {
    expect(classifyComplexity('')).toBe('simple');
  });

  it('classifies whitespace-only as simple', () => {
    expect(classifyComplexity('   \n\t  ')).toBe('simple');
  });

  it('classifies a message with code blocks as complex', () => {
    const msg = 'How do I fix this?\n```ts\nfunction foo() { return 1; }\n```';
    expect(classifyComplexity(msg)).toBe('complex');
  });

  it('classifies a message with unclosed code fence as complex', () => {
    const msg = 'Here is my code:\n```\nconst x = 1';
    expect(classifyComplexity(msg)).toBe('complex');
  });

  it('classifies a long message with technical terms as complex', () => {
    const terms = 'function class async promise error debug refactor implement algorithm database';
    // Repeat to exceed 500 chars
    const msg = Array(10).fill(terms).join(' ');
    expect(classifyComplexity(msg)).toBe('complex');
  });

  it('classifies a long message (>500 chars) as complex even without keywords', () => {
    const msg = 'a '.repeat(300); // 600 chars
    expect(classifyComplexity(msg)).toBe('complex');
  });

  it('classifies a moderate-length message without strong signals as moderate', () => {
    // >100 chars, <500 chars, no code blocks, low keyword density
    const msg = 'I want to learn about cooking and baking. Can you tell me about some great recipes for dinner tonight? Maybe something with pasta.';
    expect(msg.length).toBeGreaterThan(100);
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(classifyComplexity(msg)).toBe('moderate');
  });

  it('classifies a short message with high keyword density as complex', () => {
    // Short but every word is a keyword
    const msg = 'function class async promise error';
    expect(classifyComplexity(msg)).toBe('complex');
  });

  it('classifies exactly 100 chars (not short) with no signals as moderate', () => {
    // Exactly 100 chars — not < 100, so not simple; not > 500 nor code/keywords
    const msg = 'a'.repeat(100);
    expect(msg.length).toBe(100);
    expect(classifyComplexity(msg)).toBe('moderate');
  });

  it('classifies exactly 500 chars (not long) with no signals as moderate', () => {
    const msg = 'a '.repeat(250); // 500 chars
    expect(msg.length).toBe(500);
    expect(classifyComplexity(msg)).toBe('moderate');
  });

  it('handles extremely long message (10k+ chars)', () => {
    const msg = 'word '.repeat(2500); // ~12500 chars
    expect(classifyComplexity(msg)).toBe('complex');
  });
});

// ── selectModel ──────────────────────────────────────────────

describe('selectModel', () => {
  const defaultUser = MODEL_TIERS.moderate; // sonnet

  describe('basic auto-routing (no budget, no explicit choice)', () => {
    it('routes simple message to haiku', () => {
      const result = selectModel('hi', noBudget(), defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('simple');
    });

    it('routes moderate message to sonnet', () => {
      const msg = 'I want to learn about cooking and baking. Can you tell me about some great recipes for dinner tonight? Maybe something with pasta.';
      const result = selectModel(msg, noBudget(), defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.moderate);
      expect(result.reason).toContain('moderate');
    });

    it('routes complex message to opus', () => {
      const msg = 'Please refactor this function:\n```ts\nasync function fetchData() { return await api.query(); }\n```';
      const result = selectModel(msg, noBudget(), defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.complex);
      expect(result.reason).toContain('complex');
    });
  });

  describe('budget pressure', () => {
    it('forces haiku when budget is blocked', () => {
      const budget = budgetAt(10, 10); // 100% spent
      const result = selectModel('refactor my complex algorithm', budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('exhausted');
    });

    it('forces haiku when budget is at exactly 95%', () => {
      const budget = budgetAt(9.5, 10); // exactly 95%
      expect(budget.percentage).toBe(0.95);
      const result = selectModel('refactor my complex algorithm', budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('forced haiku');
    });

    it('forces haiku when budget is above 95%', () => {
      const budget = budgetAt(9.8, 10); // 98%
      const result = selectModel('refactor my complex algorithm', budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('forced haiku');
    });

    it('caps at sonnet during budget warning (complex message)', () => {
      const budget = budgetAt(8.5, 10); // 85% — warning but not near-blocked
      const result = selectModel(
        'Please refactor this:\n```ts\nasync function fetchData() { return await api.query(); }\n```',
        budget,
        defaultUser,
        false,
      );
      expect(result.model).toBe(MODEL_TIERS.moderate);
      expect(result.reason).toContain('capped to sonnet');
    });

    it('routes normally during warning when complexity is simple', () => {
      const budget = budgetAt(8.5, 10); // 85% — warning
      const result = selectModel('hello', budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
    });

    it('routes normally during warning when complexity is moderate', () => {
      const budget = budgetAt(8.5, 10); // 85% — warning
      const msg = 'I want to learn about cooking and baking. Can you tell me about some great recipes for dinner tonight? Maybe something with pasta.';
      const result = selectModel(msg, budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.moderate);
    });

    it('does not apply budget pressure when limit is null', () => {
      const noBudgetStatus = noBudget(100); // Spent $100 but no limit
      const result = selectModel(
        'Please refactor this:\n```ts\nasync function fetchData() { return await api.query(); }\n```',
        noBudgetStatus,
        defaultUser,
        false,
      );
      // Should route to opus — no budget enforcement
      expect(result.model).toBe(MODEL_TIERS.complex);
    });

    it('handles budget with percentage=0 (fresh budget)', () => {
      const budget = budgetAt(0, 10); // 0% spent
      expect(budget.percentage).toBe(0);
      const result = selectModel('hi', budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('simple');
    });

    it('handles budget at exactly WARNING_THRESHOLD (80%)', () => {
      const budget = budgetAt(8, 10); // exactly 80%
      expect(budget.warning).toBe(true);
      expect(budget.blocked).toBe(false);
      // Complex message should be capped to sonnet
      const msg = 'Please refactor this:\n```ts\nasync function fetchData() { return await api.query(); }\n```';
      const result = selectModel(msg, budget, defaultUser, false);
      expect(result.model).toBe(MODEL_TIERS.moderate);
      expect(result.reason).toContain('capped');
    });
  });

  describe('user explicit model choice', () => {
    it('respects user explicit choice when no budget pressure', () => {
      const result = selectModel('hi', noBudget(), MODEL_TIERS.complex, true);
      expect(result.model).toBe(MODEL_TIERS.complex);
      expect(result.reason).toBe('User choice');
    });

    it('downgrades user explicit opus to haiku when budget blocked', () => {
      const budget = budgetAt(10, 10);
      const result = selectModel('hi', budget, MODEL_TIERS.complex, true);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('exhausted');
    });

    it('downgrades user explicit opus to haiku when budget near-blocked', () => {
      const budget = budgetAt(9.7, 10);
      const result = selectModel('hi', budget, MODEL_TIERS.complex, true);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('forced haiku');
    });

    it('caps user explicit opus to sonnet during budget warning', () => {
      const budget = budgetAt(8.5, 10);
      const result = selectModel('hi', budget, MODEL_TIERS.complex, true);
      expect(result.model).toBe(MODEL_TIERS.moderate);
      expect(result.reason).toContain('capped to sonnet');
    });

    it('keeps user explicit sonnet during budget warning (already within cap)', () => {
      const budget = budgetAt(8.5, 10);
      const result = selectModel('hi', budget, MODEL_TIERS.moderate, true);
      expect(result.model).toBe(MODEL_TIERS.moderate);
      expect(result.reason).toContain('within budget cap');
    });

    it('keeps user explicit haiku during budget warning', () => {
      const budget = budgetAt(8.5, 10);
      const result = selectModel('hi', budget, MODEL_TIERS.simple, true);
      expect(result.model).toBe(MODEL_TIERS.simple);
      expect(result.reason).toContain('within budget cap');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { BudgetManager, WARNING_THRESHOLD } from '../src/budget-manager.js';
import type { BudgetStatus } from '../src/budget-manager.js';

describe('BudgetManager', () => {
  // ── Default state (no budget) ────────────────────────────────

  describe('default state (no budget)', () => {
    it('returns neutral status with no limit', () => {
      const bm = new BudgetManager();
      const status = bm.getStatus();
      expect(status.limit).toBeNull();
      expect(status.spent).toBe(0);
      expect(status.remaining).toBe(Infinity);
      expect(status.percentage).toBe(0);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });

    it('checkBudget with no limit returns safe defaults', () => {
      const bm = new BudgetManager();
      const status = bm.checkBudget(2.50);
      expect(status.limit).toBeNull();
      expect(status.spent).toBe(2.50);
      expect(status.remaining).toBe(Infinity);
      expect(status.percentage).toBe(0);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });
  });

  // ── Set budget then check ────────────────────────────────────

  describe('budget set and checked', () => {
    it('computes correct remaining and percentage', () => {
      const bm = new BudgetManager();
      bm.setBudget(10);
      const status = bm.checkBudget(3);
      expect(status.limit).toBe(10);
      expect(status.spent).toBe(3);
      expect(status.remaining).toBe(7);
      expect(status.percentage).toBeCloseTo(0.3);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });

    it('zero spending yields 0% and full remaining', () => {
      const bm = new BudgetManager();
      bm.setBudget(5);
      const status = bm.checkBudget(0);
      expect(status.remaining).toBe(5);
      expect(status.percentage).toBe(0);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });
  });

  // ── Warning threshold ────────────────────────────────────────

  describe('warning threshold', () => {
    it('79% → no warning', () => {
      const bm = new BudgetManager();
      bm.setBudget(100);
      const status = bm.checkBudget(79);
      expect(status.percentage).toBeCloseTo(0.79);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });

    it('80% → warning', () => {
      const bm = new BudgetManager();
      bm.setBudget(100);
      const status = bm.checkBudget(80);
      expect(status.percentage).toBeCloseTo(0.80);
      expect(status.warning).toBe(true);
      expect(status.blocked).toBe(false);
    });

    it('90% → warning but not blocked', () => {
      const bm = new BudgetManager();
      bm.setBudget(10);
      const status = bm.checkBudget(9);
      expect(status.percentage).toBeCloseTo(0.9);
      expect(status.warning).toBe(true);
      expect(status.blocked).toBe(false);
    });

    it('100% → blocked (and warning)', () => {
      const bm = new BudgetManager();
      bm.setBudget(10);
      const status = bm.checkBudget(10);
      expect(status.percentage).toBeCloseTo(1.0);
      expect(status.blocked).toBe(true);
      expect(status.warning).toBe(true);
    });

    it('WARNING_THRESHOLD is 0.8', () => {
      expect(WARNING_THRESHOLD).toBe(0.8);
    });
  });

  // ── Over budget ──────────────────────────────────────────────

  describe('over budget', () => {
    it('spent > limit → blocked true, remaining negative', () => {
      const bm = new BudgetManager();
      bm.setBudget(5);
      const status = bm.checkBudget(7);
      expect(status.blocked).toBe(true);
      expect(status.remaining).toBe(-2);
      expect(status.percentage).toBeCloseTo(1.4);
      expect(status.warning).toBe(true);
    });
  });

  // ── Null budget (clear) ──────────────────────────────────────

  describe('clearing budget with null', () => {
    it('setBudget(null) clears limit and returns safe defaults', () => {
      const bm = new BudgetManager();
      bm.setBudget(10);
      bm.checkBudget(5);
      bm.setBudget(null);
      const status = bm.getStatus();
      expect(status.limit).toBeNull();
      expect(status.spent).toBe(5); // retains last spent
      expect(status.remaining).toBe(Infinity);
      expect(status.percentage).toBe(0);
      expect(status.warning).toBe(false);
      expect(status.blocked).toBe(false);
    });
  });

  // ── Edge: setBudget(0) ───────────────────────────────────────

  describe('zero budget', () => {
    it('setBudget(0) → immediately blocked', () => {
      const bm = new BudgetManager();
      bm.setBudget(0);
      const status = bm.checkBudget(0);
      expect(status.limit).toBe(0);
      expect(status.blocked).toBe(true);
      expect(status.remaining).toBe(0);
    });

    it('setBudget(0) with positive spending → blocked, negative remaining', () => {
      const bm = new BudgetManager();
      bm.setBudget(0);
      const status = bm.checkBudget(0.01);
      expect(status.blocked).toBe(true);
      expect(status.remaining).toBe(-0.01);
    });
  });

  // ── getStatus reflects last checkBudget ──────────────────────

  describe('getStatus', () => {
    it('reflects last checkBudget result', () => {
      const bm = new BudgetManager();
      bm.setBudget(10);
      bm.checkBudget(3);
      const s1 = bm.getStatus();
      expect(s1.spent).toBe(3);

      bm.checkBudget(8);
      const s2 = bm.getStatus();
      expect(s2.spent).toBe(8);
      expect(s2.warning).toBe(true);
    });

    it('returns neutral status before any checkBudget calls when no limit', () => {
      const bm = new BudgetManager();
      const status = bm.getStatus();
      expect(status.limit).toBeNull();
      expect(status.spent).toBe(0);
    });
  });
});

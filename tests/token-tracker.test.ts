import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenTracker,
  MODEL_PRICING,
  resolveModelPrefix,
} from '../src/token-tracker.js';

describe('resolveModelPrefix', () => {
  it('strips date suffix from sonnet model ID', () => {
    expect(resolveModelPrefix('claude-sonnet-4-20250514')).toBe('claude-sonnet-4');
  });

  it('strips date suffix from haiku model ID', () => {
    expect(resolveModelPrefix('claude-haiku-4-20250514')).toBe('claude-haiku-4');
  });

  it('strips date suffix from opus model ID', () => {
    expect(resolveModelPrefix('claude-opus-4-20250514')).toBe('claude-opus-4');
  });

  it('matches exact prefix without date suffix', () => {
    expect(resolveModelPrefix('claude-sonnet-4')).toBe('claude-sonnet-4');
  });

  it('returns undefined for unknown models', () => {
    expect(resolveModelPrefix('gpt-4o')).toBeUndefined();
    expect(resolveModelPrefix('unknown-model')).toBeUndefined();
  });
});

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe('addUsage + getState', () => {
    it('starts at zero', () => {
      expect(tracker.getState()).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });

    it('accumulates a single usage', () => {
      tracker.addUsage({ input_tokens: 100, output_tokens: 50 });
      expect(tracker.getState()).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });

    it('accumulates multiple usages', () => {
      tracker.addUsage({ input_tokens: 100, output_tokens: 50 });
      tracker.addUsage({ input_tokens: 200, output_tokens: 75 });
      tracker.addUsage({ input_tokens: 50, output_tokens: 25 });
      expect(tracker.getState()).toEqual({
        inputTokens: 350,
        outputTokens: 150,
        totalTokens: 500,
      });
    });
  });

  describe('getCost', () => {
    it('computes cost for claude-sonnet-4 ($3/$15 per MTok)', () => {
      tracker.addUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
      const cost = tracker.getCost('claude-sonnet-4-20250514');
      expect(cost.inputCost).toBeCloseTo(3.0);
      expect(cost.outputCost).toBeCloseTo(15.0);
      expect(cost.totalCost).toBeCloseTo(18.0);
    });

    it('computes cost for claude-haiku-4 ($1/$5 per MTok)', () => {
      tracker.addUsage({ input_tokens: 500_000, output_tokens: 200_000 });
      const cost = tracker.getCost('claude-haiku-4-20250514');
      expect(cost.inputCost).toBeCloseTo(0.5);
      expect(cost.outputCost).toBeCloseTo(1.0);
      expect(cost.totalCost).toBeCloseTo(1.5);
    });

    it('computes cost for claude-opus-4 ($5/$25 per MTok)', () => {
      tracker.addUsage({ input_tokens: 2_000_000, output_tokens: 500_000 });
      const cost = tracker.getCost('claude-opus-4-20250514');
      expect(cost.inputCost).toBeCloseTo(10.0);
      expect(cost.outputCost).toBeCloseTo(12.5);
      expect(cost.totalCost).toBeCloseTo(22.5);
    });

    it('returns zeros for unknown model', () => {
      tracker.addUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
      const cost = tracker.getCost('gpt-4o-mini');
      expect(cost).toEqual({ inputCost: 0, outputCost: 0, totalCost: 0 });
    });

    it('works with model prefix without date suffix', () => {
      tracker.addUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
      const cost = tracker.getCost('claude-sonnet-4');
      expect(cost.inputCost).toBeCloseTo(3.0);
      expect(cost.outputCost).toBeCloseTo(15.0);
    });
  });

  describe('reset', () => {
    it('zeroes all counters', () => {
      tracker.addUsage({ input_tokens: 500, output_tokens: 300 });
      tracker.reset();
      expect(tracker.getState()).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });

    it('allows fresh accumulation after reset', () => {
      tracker.addUsage({ input_tokens: 500, output_tokens: 300 });
      tracker.reset();
      tracker.addUsage({ input_tokens: 100, output_tokens: 50 });
      expect(tracker.getState()).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });
});

describe('MODEL_PRICING', () => {
  it('has entries for sonnet, haiku, and opus', () => {
    expect(MODEL_PRICING['claude-sonnet-4']).toBeDefined();
    expect(MODEL_PRICING['claude-haiku-4']).toBeDefined();
    expect(MODEL_PRICING['claude-opus-4']).toBeDefined();
  });
});

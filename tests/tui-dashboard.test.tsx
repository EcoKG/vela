import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Dashboard } from '../src/tui/Dashboard.js';
import type { DashboardProps } from '../src/tui/Dashboard.js';

// ── Helpers ────────────────────────────────────────────────────

function makeProps(overrides?: Partial<DashboardProps>): DashboardProps {
  return {
    inputTokens: 1500,
    outputTokens: 800,
    totalTokens: 2300,
    estimatedCost: { inputCost: 0.0045, outputCost: 0.012, totalCost: 0.0165 },
    model: 'claude-sonnet-4-20250514',
    pipelineMode: null,
    sessionId: null,
    sessionTitle: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Dashboard', () => {
  it('renders all sections with valid props', () => {
    const props = makeProps({
      pipelineMode: 'execute',
      sessionId: 'sess-abc123',
      sessionTitle: 'Feature work',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('📊 Dashboard');
    expect(frame).toContain('1500');
    expect(frame).toContain('800');
    expect(frame).toContain('2300');
    expect(frame).toContain('$0.0165');
    expect(frame).toContain('claude-sonnet-4-20250514');
    expect(frame).toContain('Pipeline:');
    expect(frame).toContain('execute');
    expect(frame).toContain('Session:');
    expect(frame).toContain('Feature work');
  });

  it('returns null when all tokens are 0', () => {
    const props = makeProps({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).toBe('');
  });

  it('omits pipeline section when pipelineMode is null', () => {
    const props = makeProps({ pipelineMode: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('📊 Dashboard');
    expect(frame).not.toContain('Pipeline:');
  });

  it('omits session section when sessionId is null', () => {
    const props = makeProps({ sessionId: null, sessionTitle: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('📊 Dashboard');
    expect(frame).not.toContain('Session:');
  });

  it('shows sessionTitle over sessionId when both present', () => {
    const props = makeProps({
      sessionId: 'sess-xyz789',
      sessionTitle: 'My Session',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('My Session');
    expect(frame).not.toContain('sess-xyz789');
  });

  it('shows sessionId when sessionTitle is null', () => {
    const props = makeProps({
      sessionId: 'sess-xyz789',
      sessionTitle: null,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('sess-xyz789');
  });

  it('formats cost with toFixed(4) precision', () => {
    const props = makeProps({
      estimatedCost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('$0.0030');
    expect(frame).toContain('$0.0010');
    expect(frame).toContain('$0.0020');
  });

  it('omits cost breakdown when both input and output costs are 0', () => {
    const props = makeProps({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('$0.0000');
    // No breakdown parenthetical when costs are zero
    expect(frame).not.toContain('(in:');
  });

  // ── Budget display tests ──────────────────────────────────────

  it('renders budget section when budgetLimit is set', () => {
    const props = makeProps({
      budgetLimit: 5,
      budgetSpent: 1.5,
      budgetRemaining: 3.5,
      budgetPercentage: 0.3,
      budgetWarning: false,
      budgetBlocked: false,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('Budget:');
    expect(frame).toContain('$1.5000');
    expect(frame).toContain('$5.0000');
    expect(frame).toContain('30% used');
    expect(frame).toContain('$3.5000 remaining');
  });

  it('does NOT render budget section when budgetLimit is null', () => {
    const props = makeProps({ budgetLimit: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).not.toContain('Budget:');
  });

  it('does NOT render budget section when budgetLimit is undefined', () => {
    const props = makeProps();
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).not.toContain('Budget:');
  });

  it('shows green color state when under 80%', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 5,
      budgetRemaining: 5,
      budgetPercentage: 0.5,
      budgetWarning: false,
      budgetBlocked: false,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('Budget:');
    expect(frame).toContain('50% used');
    expect(frame).not.toContain('⛔');
    expect(frame).not.toContain('⚠️');
  });

  it('shows yellow warning state at 80%', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 8,
      budgetRemaining: 2,
      budgetPercentage: 0.8,
      budgetWarning: true,
      budgetBlocked: false,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('80% used');
    expect(frame).toContain('⚠️');
    expect(frame).not.toContain('⛔');
  });

  it('shows red blocked state at 100%', () => {
    const props = makeProps({
      budgetLimit: 5,
      budgetSpent: 5.5,
      budgetRemaining: 0,
      budgetPercentage: 1.1,
      budgetWarning: true,
      budgetBlocked: true,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('110% used');
    expect(frame).toContain('⛔ BLOCKED');
    expect(frame).not.toContain('⚠️');
  });

  it('shows remaining amount in budget section', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 3,
      budgetRemaining: 7,
      budgetPercentage: 0.3,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).toContain('$7.0000 remaining');
  });

  // ── Auto-routed model display tests ───────────────────────────

  it('shows auto-routed model when routedModel differs from model', () => {
    const props = makeProps({
      routedModel: 'claude-haiku-4-20250514',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame();

    expect(frame).toContain('Auto-routed:');
    expect(frame).toContain('claude-haiku-4-20250514');
  });

  it('does NOT show auto-routed when routedModel is null', () => {
    const props = makeProps({ routedModel: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).not.toContain('Auto-routed:');
  });

  it('does NOT show auto-routed when routedModel equals model', () => {
    const props = makeProps({
      model: 'claude-sonnet-4-20250514',
      routedModel: 'claude-sonnet-4-20250514',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).not.toContain('Auto-routed:');
  });

  it('does NOT show auto-routed when routedModel is undefined', () => {
    const props = makeProps();
    const { lastFrame } = render(<Dashboard {...props} />);
    expect(lastFrame()).not.toContain('Auto-routed:');
  });
});

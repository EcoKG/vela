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
    const frame = lastFrame()!;

    expect(frame).toContain('📊 Dashboard');
    expect(frame).toContain('1500');
    expect(frame).toContain('800');
    expect(frame).toContain('$0.0165');
    expect(frame).toContain('claude-sonnet-4-20250514');
    expect(frame).toContain('execute');
    expect(frame).toContain('Feature work');
  });

  it('shows only model and title when all tokens are 0', () => {
    const props = makeProps({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    // Dashboard still renders with model but no token/cost sections
    expect(frame).toContain('📊 Dashboard');
    expect(frame).toContain('claude-sonnet-4-20250514');
    expect(frame).not.toContain('tok');
  });

  it('omits pipeline section when pipelineMode is null', () => {
    const props = makeProps({ pipelineMode: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('📊 Dashboard');
    // No ⚙️ line
    expect(frame).not.toContain('⚙️');
  });

  it('omits session section when sessionId is null', () => {
    const props = makeProps({ sessionId: null, sessionTitle: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    // No 📝 line
    expect(frame).not.toContain('📝');
  });

  it('shows sessionTitle over sessionId when both present', () => {
    const props = makeProps({
      sessionId: 'sess-abc123',
      sessionTitle: 'My Session',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('My Session');
  });

  it('shows sessionId when sessionTitle is null', () => {
    const props = makeProps({
      sessionId: 'sess-xyz789',
      sessionTitle: null,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('sess-xyz');
  });

  it('formats cost with toFixed(4) precision', () => {
    const props = makeProps({
      estimatedCost: { inputCost: 0.001, outputCost: 0, totalCost: 0.001 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('$0.0010');
  });

  it('omits cost breakdown when both input and output costs are 0', () => {
    const props = makeProps({
      estimatedCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    // No cost breakdown parenthetical
    expect(frame).not.toContain('(0');
  });

  it('renders budget section when budgetLimit is set', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 2,
      budgetRemaining: 8,
      budgetPercentage: 0.2,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('🎯');
    expect(frame).toContain('10.00');
  });

  it('does NOT render budget section when budgetLimit is null', () => {
    const props = makeProps({ budgetLimit: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🎯');
  });

  it('does NOT render budget section when budgetLimit is undefined', () => {
    const props = makeProps({ budgetLimit: undefined });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🎯');
  });

  it('shows warning icon at 80%', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 8,
      budgetRemaining: 2,
      budgetPercentage: 0.8,
      budgetWarning: true,
      budgetBlocked: false,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⚠️');
    expect(frame).not.toContain('⛔');
  });

  it('shows blocked icon at 100%', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 11,
      budgetRemaining: 0,
      budgetPercentage: 1.1,
      budgetWarning: true,
      budgetBlocked: true,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⛔');
  });

  it('shows remaining amount in budget section', () => {
    const props = makeProps({
      budgetLimit: 10,
      budgetSpent: 3,
      budgetRemaining: 7,
      budgetPercentage: 0.3,
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('3.000');
    expect(frame).toContain('10.00');
  });

  it('shows auto-routed model when routedModel differs from model', () => {
    const props = makeProps({
      routedModel: 'claude-haiku-4-20250514',
    });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('🔄');
    expect(frame).toContain('claude-haiku-4-20250514');
  });

  it('does NOT show auto-routed when routedModel is null', () => {
    const props = makeProps({ routedModel: null });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🔄');
  });

  it('does NOT show auto-routed when routedModel equals model', () => {
    const props = makeProps({ routedModel: 'claude-sonnet-4-20250514' });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🔄');
  });

  it('does NOT show auto-routed when routedModel is undefined', () => {
    const props = makeProps({ routedModel: undefined });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🔄');
  });

  it('shows Claude CLI when providerType is cli', () => {
    const props = makeProps({ providerType: 'cli' });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('🔌');
    expect(frame).toContain('Claude CLI');
  });

  it('shows API when providerType is api', () => {
    const props = makeProps({ providerType: 'api' });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).toContain('🔌');
    expect(frame).toContain('API');
  });

  it('does NOT show Provider section when providerType is undefined', () => {
    const props = makeProps({ providerType: undefined });
    const { lastFrame } = render(<Dashboard {...props} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('🔌');
  });
});

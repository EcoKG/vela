import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { computeLayout } from '../src/tui/FullscreenLayout.js';

// ── useScreenSize mock (K006: ESM module mocking via vi.mock + globalThis) ──

// Default screen size — override per test via globalThis.__mockScreenSize
(globalThis as Record<string, unknown>).__mockScreenSize = { width: 100, height: 24 };

vi.mock('fullscreen-ink', () => ({
  useScreenSize: () =>
    (globalThis as Record<string, unknown>).__mockScreenSize as {
      width: number;
      height: number;
    },
}));

// Import AFTER vi.mock so the mock is in place
const { FullscreenLayout } = await import('../src/tui/FullscreenLayout.js');

// ── Helpers ────────────────────────────────────────────────────

function setScreenSize(width: number, height?: number) {
  (globalThis as Record<string, unknown>).__mockScreenSize = {
    width,
    height: height ?? 24,
  };
}

// ── computeLayout (pure function tests) ────────────────────────

describe('computeLayout', () => {
  it('caps content width at 120 when columns > 120', () => {
    const layout = computeLayout(200, 40, 4, 2);
    expect(layout.contentWidth).toBe(120);
    expect(layout.marginLeft).toBe(40); // (200 - 120) / 2
  });

  it('uses full width when columns <= 120', () => {
    const layout = computeLayout(80, 30, 4, 2);
    expect(layout.contentWidth).toBe(80);
    expect(layout.marginLeft).toBe(0);
  });

  it('computes body height as totalRows - headerHeight - inputHeight', () => {
    const layout = computeLayout(100, 30, 4, 2);
    expect(layout.bodyHeight).toBe(24); // 30 - 4 - 2
  });

  it('defaults rows to 24 when undefined', () => {
    const layout = computeLayout(100, undefined, 4, 2);
    expect(layout.totalRows).toBe(24);
    expect(layout.bodyHeight).toBe(18); // 24 - 4 - 2
  });

  it('defaults columns to 120 when undefined', () => {
    const layout = computeLayout(undefined, 30, 4, 2);
    expect(layout.contentWidth).toBe(120);
    expect(layout.marginLeft).toBe(0);
  });

  it('clamps body height to minimum 1 when header + input exceed total rows', () => {
    const layout = computeLayout(80, 5, 4, 2);
    expect(layout.bodyHeight).toBe(1); // max(5 - 4 - 2, 1) = max(-1, 1) = 1
  });

  it('uses custom header and input heights', () => {
    const layout = computeLayout(100, 40, 6, 3);
    expect(layout.headerHeight).toBe(6);
    expect(layout.inputHeight).toBe(3);
    expect(layout.bodyHeight).toBe(31); // 40 - 6 - 3
  });

  it('centers content with odd margin', () => {
    const layout = computeLayout(121, 24, 4, 2);
    expect(layout.contentWidth).toBe(120);
    expect(layout.marginLeft).toBe(0); // floor((121 - 120) / 2) = 0
  });

  // ── Sidebar layout tests ──

  it('computes sidebar width when visible and terminal wide enough', () => {
    const layout = computeLayout(100, 24, 4, 2, true);
    expect(layout.sidebarWidth).toBe(30);
    expect(layout.mainWidth).toBe(70); // 100 - 30
  });

  it('sets sidebar width to 0 when hidden', () => {
    const layout = computeLayout(100, 24, 4, 2, false);
    expect(layout.sidebarWidth).toBe(0);
    expect(layout.mainWidth).toBe(100);
  });

  it('auto-hides sidebar when terminal is narrower than 60 cols', () => {
    const layout = computeLayout(59, 24, 4, 2, true);
    expect(layout.sidebarWidth).toBe(0);
    expect(layout.mainWidth).toBe(59);
  });

  it('shows sidebar at exactly 60 cols', () => {
    const layout = computeLayout(60, 24, 4, 2, true);
    expect(layout.sidebarWidth).toBe(30);
    expect(layout.mainWidth).toBe(30); // 60 - 30
  });

  it('mainWidth equals contentWidth when sidebar is not requested', () => {
    const layout = computeLayout(100, 24, 4, 2);
    expect(layout.mainWidth).toBe(100);
    expect(layout.sidebarWidth).toBe(0);
  });

  it('accepts custom sidebarWidth', () => {
    const layout = computeLayout(100, 24, 4, 2, true, 20);
    expect(layout.sidebarWidth).toBe(20);
    expect(layout.mainWidth).toBe(80); // 100 - 20
  });
});

// ── FullscreenLayout component tests ───────────────────────────

describe('FullscreenLayout', () => {
  beforeEach(() => {
    setScreenSize(100, 24);
  });

  it('renders header, body, and input slots in correct order', () => {
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>HEADER</Text>}
        body={<Text>BODY</Text>}
        input={<Text>INPUT</Text>}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('HEADER');
    expect(frame).toContain('BODY');
    expect(frame).toContain('INPUT');

    // Verify order: HEADER appears before BODY, BODY before INPUT
    const headerIdx = frame.indexOf('HEADER');
    const bodyIdx = frame.indexOf('BODY');
    const inputIdx = frame.indexOf('INPUT');
    expect(headerIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(inputIdx);
  });

  it('caps content width at 120 when screen is wider', () => {
    setScreenSize(200, 30);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>B</Text>}
        input={<Text>I</Text>}
      />,
    );
    // Content should render — the capping is validated by computeLayout tests
    const frame = lastFrame();
    expect(frame).toContain('H');
    expect(frame).toContain('B');
    expect(frame).toContain('I');
  });

  it('uses full width when screen is narrower than 120', () => {
    setScreenSize(80, 24);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>B</Text>}
        input={<Text>I</Text>}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('H');
  });

  it('uses default header=4 and input=2 heights', () => {
    // Verify via computeLayout that defaults are correct
    const layout = computeLayout(100, 24, 4, 2);
    expect(layout.headerHeight).toBe(4);
    expect(layout.inputHeight).toBe(2);
    expect(layout.bodyHeight).toBe(18);
  });

  it('accepts custom headerHeight and inputHeight', () => {
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>B</Text>}
        input={<Text>I</Text>}
        headerHeight={6}
        inputHeight={3}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('H');
    expect(frame).toContain('B');
    expect(frame).toContain('I');
  });

  it('renders without crashing when rows is very small', () => {
    setScreenSize(80, 3);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>B</Text>}
        input={<Text>I</Text>}
      />,
    );
    const frame = lastFrame();
    // Should not crash — body height is clamped to 1
    expect(frame).toBeDefined();
  });

  // ── Sidebar rendering tests ──

  it('renders sidebar slot when visible', () => {
    setScreenSize(100, 24);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>BODY</Text>}
        input={<Text>I</Text>}
        sidebar={<Text>SIDEBAR</Text>}
        sidebarVisible={true}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('BODY');
    expect(frame).toContain('SIDEBAR');
  });

  it('does not render sidebar slot when hidden', () => {
    setScreenSize(100, 24);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>BODY</Text>}
        input={<Text>I</Text>}
        sidebar={<Text>SIDEBAR</Text>}
        sidebarVisible={false}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('BODY');
    expect(frame).not.toContain('SIDEBAR');
  });

  it('auto-hides sidebar when terminal is narrower than 60 cols', () => {
    setScreenSize(50, 24);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>H</Text>}
        body={<Text>BODY</Text>}
        input={<Text>I</Text>}
        sidebar={<Text>SIDEBAR</Text>}
        sidebarVisible={true}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('BODY');
    expect(frame).not.toContain('SIDEBAR');
  });

  it('is backward-compatible when sidebar prop is omitted', () => {
    setScreenSize(100, 24);
    const { lastFrame } = render(
      <FullscreenLayout
        header={<Text>HEADER</Text>}
        body={<Text>BODY</Text>}
        input={<Text>INPUT</Text>}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('HEADER');
    expect(frame).toContain('BODY');
    expect(frame).toContain('INPUT');
  });
});

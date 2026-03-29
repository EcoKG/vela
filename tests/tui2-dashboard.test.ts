/**
 * Tests for Dashboard Renderable component.
 *
 * Dashboard is a pure Renderable — no terminal/TUI dependency.
 * Tests cover rendering structure, data formatting, and width handling.
 */

import { describe, it, expect } from "vitest";
import stripAnsi from "strip-ansi";
import {
  Dashboard,
  formatNumber,
  formatCost,
} from "../src/tui2/components/dashboard.js";

function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe("Dashboard rendering", () => {
  it("renders correct structure with default (zero) data", () => {
    const dashboard = new Dashboard();
    const lines = dashboard.render(32);
    const plain = strip(lines);

    expect(plain.length).toBe(6);
    expect(plain[0]).toContain("⛵ Dashboard");
    expect(plain[1]).toContain("─");
    expect(plain[2]).toContain("Model:");
    expect(plain[3]).toContain("Input:");
    expect(plain[4]).toContain("Output:");
    expect(plain[5]).toContain("Cost:");
  });

  it("renders formatted token counts and cost after setData()", () => {
    const dashboard = new Dashboard();
    dashboard.setData({
      model: "claude-sonnet-4-20250514",
      inputTokens: 12345,
      outputTokens: 6789,
      cost: 0.0523,
    });

    const lines = dashboard.render(40);
    const plain = strip(lines);

    expect(plain[2]).toContain("claude-sonnet-4-20250514");
    expect(plain[3]).toContain("12,345");
    expect(plain[4]).toContain("6,789");
    expect(plain[5]).toContain("$0.05");
  });

  it("respects width parameter — border character present on each line", () => {
    const dashboard = new Dashboard();
    const lines = dashboard.render(20);
    const plain = strip(lines);

    for (const line of plain) {
      expect(line.startsWith("│")).toBe(true);
    }
  });

  it("shows model name, truncated if too long", () => {
    const dashboard = new Dashboard();
    dashboard.setData({
      model: "claude-sonnet-4-20250514-extra-long-model-name",
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    });

    // With narrow width, model name should be truncated with ellipsis
    const lines = dashboard.render(24);
    const plain = strip(lines);
    const modelLine = plain[2]!;

    expect(modelLine).toContain("Model:");
    // Should have an ellipsis if truncated
    expect(modelLine).toContain("…");
  });

  it("shows full model name when width is sufficient", () => {
    const dashboard = new Dashboard();
    dashboard.setData({
      model: "claude-sonnet-4-20250514",
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    });

    const lines = dashboard.render(50);
    const plain = strip(lines);

    expect(plain[2]).toContain("claude-sonnet-4-20250514");
    expect(plain[2]).not.toContain("…");
  });

  it("has border character │ on left edge of every line", () => {
    const dashboard = new Dashboard();
    dashboard.setData({
      model: "test-model",
      inputTokens: 999,
      outputTokens: 111,
      cost: 1.5,
    });

    const lines = dashboard.render(32);

    // Raw lines contain ANSI-colored │
    for (const line of lines) {
      expect(line).toContain("│");
    }
  });
});

describe("formatNumber", () => {
  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats small numbers without commas", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats large numbers with commas", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("formatCost", () => {
  it("formats zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs with 4 decimal places", () => {
    expect(formatCost(0.0001)).toBe("$0.0001");
    expect(formatCost(0.0099)).toBe("$0.0099");
  });

  it("formats larger costs with 2 decimal places", () => {
    expect(formatCost(0.05)).toBe("$0.05");
    expect(formatCost(1.23)).toBe("$1.23");
    expect(formatCost(10.5)).toBe("$10.50");
  });
});

/**
 * Unit tests for MessageList tui2 component.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import { MessageList } from '../src/tui2/components/message-list.js';
import type { DisplayMessage } from '../src/tui2/components/message-list.js';

/** Strip ANSI from all lines for content assertions. */
function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

describe('MessageList', () => {
  let ml: MessageList;

  beforeEach(() => {
    ml = new MessageList();
  });

  it('renders empty array when no messages', () => {
    const lines = ml.render(80);
    expect(lines).toEqual([]);
  });

  it('renders user message with "You ▎" label right-aligned and indented content', () => {
    ml.addMessage({ role: 'user', content: 'Hello world' });
    const lines = strip(ml.render(80));

    expect(lines[0]).toContain('You ▎');
    // Content should be indented 2 spaces
    expect(lines[1]).toBe('  Hello world');
  });

  it('renders assistant message with "⛵ Vela" label and bordered Markdown content', () => {
    ml.addMessage({ role: 'assistant', content: 'Hello **user**' });
    const lines = strip(ml.render(80));

    expect(lines[0]).toBe('⛵ Vela');
    // Content lines get '▎ ' border prefix
    expect(lines.some((l) => l.startsWith('▎ ') && l.includes('Hello') && l.includes('user'))).toBe(true);
  });

  it('renders system message with badge and dim/italic content', () => {
    ml.addMessage({ role: 'system', content: 'System notice' });
    const raw = ml.render(80);
    const lines = strip(raw);

    // Badge line
    expect(lines[0]).toContain('SYSTEM');
    // Content on subsequent line
    expect(lines.some((l) => l.includes('System notice'))).toBe(true);
    // Raw output should contain dim/italic ANSI codes in content
    expect(raw.some((l) => l.includes('\x1b[90m') && l.includes('\x1b[3m'))).toBe(true);
  });

  it('renders streaming text with role label and partial content', () => {
    ml.setStreamingText('Partial response so far');
    const lines = strip(ml.render(80));

    expect(lines[0]).toBe('⛵ Vela');
    expect(lines.some((l) => l.includes('Partial response so far'))).toBe(true);
  });

  it('renders thinking indicator when streaming text is empty', () => {
    ml.setStreamingText('');
    const lines = strip(ml.render(80));

    // Should render label + thinking indicator
    expect(lines[0]).toBe('⛵ Vela');
    expect(lines[1]).toContain('Thinking');
  });

  it('renders tool activity lines with correct status icons', () => {
    ml.addStreamingTool('bash', 'running');
    ml.addStreamingTool('read_file', 'done');
    ml.setStreamingText('Working on it...');
    const lines = strip(ml.render(80));

    const toolLines = lines.filter((l) => l.includes('bash') || l.includes('read_file'));
    expect(toolLines.some((l) => l.includes('⏳') && l.includes('bash'))).toBe(true);
    expect(toolLines.some((l) => l.includes('✓') && l.includes('read_file'))).toBe(true);
  });

  it('renders tool calls on completed assistant messages', () => {
    const msg: DisplayMessage = {
      role: 'assistant',
      content: 'Done.',
      toolCalls: [
        { toolName: 'bash', status: 'done' },
        { toolName: 'read', status: 'done', summary: 'read a file' },
      ],
    };
    ml.addMessage(msg);
    const lines = strip(ml.render(80));

    expect(lines.some((l) => l.includes('✓') && l.includes('bash'))).toBe(true);
    expect(lines.some((l) => l.includes('✓') && l.includes('read'))).toBe(true);
  });

  it('renders multiple messages in order with horizontal rule separators', () => {
    ml.addMessage({ role: 'user', content: 'First' });
    ml.addMessage({ role: 'assistant', content: 'Second' });
    ml.addMessage({ role: 'user', content: 'Third' });

    const lines = strip(ml.render(80));

    // Find the positions of the role labels
    const youIndices = lines.reduce<number[]>((acc, l, i) => {
      if (l.includes('You ▎')) acc.push(i);
      return acc;
    }, []);
    const velaIndices = lines.reduce<number[]>((acc, l, i) => {
      if (l === '⛵ Vela') acc.push(i);
      return acc;
    }, []);

    expect(youIndices.length).toBe(2);
    expect(velaIndices.length).toBe(1);

    // Horizontal rule separator (─) between first user message and assistant
    const firstYouIdx = youIndices[0]!;
    const velaIdx = velaIndices[0]!;
    expect(velaIdx).toBeGreaterThan(firstYouIdx);
    // There should be a line with ─ chars between messages
    expect(lines.some((l, i) => l.includes('─') && i > firstYouIdx && i < velaIdx)).toBe(true);
  });

  it('addStreamingTool updates existing tool status', () => {
    ml.setStreamingText('Processing...');
    ml.addStreamingTool('bash', 'running');
    ml.addStreamingTool('bash', 'done'); // update to done

    const lines = strip(ml.render(80));
    const toolLine = lines.find((l) => l.includes('bash'));
    expect(toolLine).toContain('✓');
    expect(toolLine).not.toContain('⏳');
  });

  it('clear() resets all state', () => {
    ml.addMessage({ role: 'user', content: 'Hello' });
    ml.setStreamingText('Streaming...');
    ml.addStreamingTool('bash', 'running');
    ml.clear();

    const lines = ml.render(80);
    expect(lines).toEqual([]);
  });

  it('clearStreamingTools() removes tool indicators', () => {
    ml.setStreamingText('Working...');
    ml.addStreamingTool('bash', 'running');
    ml.clearStreamingTools();

    const lines = strip(ml.render(80));
    expect(lines.some((l) => l.includes('bash'))).toBe(false);
    expect(lines.some((l) => l.includes('Working...'))).toBe(true);
  });

  it('uses render cache when content unchanged', () => {
    ml.addMessage({ role: 'user', content: 'Cached' });
    const first = ml.render(80);
    const second = ml.render(80);
    // Same reference = cache hit
    expect(first).toBe(second);
  });

  it('invalidates cache when width changes', () => {
    ml.addMessage({ role: 'user', content: 'Width test' });
    const first = ml.render(80);
    const second = ml.render(60);
    expect(first).not.toBe(second);
  });

  // ── Right-alignment correctness (step 6) ────────────────────────────

  it('user label right-aligned correctly at width=40', () => {
    ml.addMessage({ role: 'user', content: 'Hi' });
    const lines = ml.render(40);
    const stripped = stripAnsi(lines[0]!);
    // 'You ▎' label should pad to fill width=40
    expect(stripped).toContain('You ▎');
    const trimmed = stripped.trimStart();
    expect(trimmed).toBe('You ▎');
    // Leading padding + label fills the line to width
    const leadingSpaces = stripped.length - trimmed.length;
    expect(leadingSpaces).toBeGreaterThan(0);
    // Label is pushed far right (more padding than label width)
    expect(leadingSpaces).toBeGreaterThan(trimmed.length);
  });

  it('user label right-aligned correctly at width=80', () => {
    ml.addMessage({ role: 'user', content: 'Hi' });
    const lines = ml.render(80);
    const stripped = stripAnsi(lines[0]!);
    expect(stripped).toContain('You ▎');
    // Leading spaces push label to the right edge
    const trimmed = stripped.trimStart();
    expect(trimmed).toBe('You ▎');
    const leadingSpaces = stripped.length - trimmed.length;
    // Label 'You ▎' has visible width ~5 (You=3 + space=1 + ▎=1)
    expect(leadingSpaces).toBeGreaterThan(0);
  });

  // ── System badge ANSI (step 7) ──────────────────────────────────────

  it('system badge contains background ANSI escape code', () => {
    ml.addMessage({ role: 'system', content: 'Notice' });
    const raw = ml.render(80);
    const badgeLine = raw[0]!;
    // Background ANSI code: \x1b[4Xm where X is 0-7
    expect(badgeLine).toMatch(/\x1b\[4[0-7]m/);
    // Contains SYSTEM text
    expect(stripAnsi(badgeLine)).toContain('SYSTEM');
  });

  // ── Assistant border indicator (step 8) ──────────────────────────────

  it('assistant message content lines contain ▎ border indicator', () => {
    ml.addMessage({ role: 'assistant', content: 'Line one\nLine two' });
    const lines = strip(ml.render(80));
    // Skip the label line ('⛵ Vela'), content lines should start with ▎
    const contentLines = lines.filter((l) => l.startsWith('▎'));
    expect(contentLines.length).toBeGreaterThanOrEqual(2);
    expect(contentLines.some((l) => l.includes('Line one'))).toBe(true);
    expect(contentLines.some((l) => l.includes('Line two'))).toBe(true);
  });

  it('streaming assistant content also has ▎ border', () => {
    ml.setStreamingText('Streaming content');
    const lines = strip(ml.render(80));
    const bordered = lines.filter((l) => l.startsWith('▎'));
    expect(bordered.length).toBeGreaterThanOrEqual(1);
    expect(bordered.some((l) => l.includes('Streaming content'))).toBe(true);
  });

  it('streaming separator: horizontal rule between committed messages and streaming', () => {
    ml.addMessage({ role: 'user', content: 'Hi' });
    ml.setStreamingText('Responding...');
    const lines = strip(ml.render(80));

    // Should have a horizontal rule (─) between committed message and streaming
    const ruleIdx = lines.findIndex((l) => l.includes('─'));
    expect(ruleIdx).toBeGreaterThan(0);
    // ⛵ Vela label should follow the rule
    expect(lines[ruleIdx + 1]).toBe('⛵ Vela');
  });
});

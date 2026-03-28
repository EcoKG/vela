import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { MessageBubble } from '../src/tui/MessageBubble.js';
import { ToolCallBlock } from '../src/tui/ToolCallBlock.js';
import type { Message } from '../src/tui/MessageList.js';
import type { ToolCallInfo } from '../src/tui/ToolCallBlock.js';

// ── MessageBubble ──────────────────────────────────────────────

describe('MessageBubble', () => {
  it('renders user message with "You" label', () => {
    const msg: Message = { role: 'user', content: 'Hello world' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame()!;
    expect(frame).toContain('You');
    expect(frame).toContain('Hello world');
  });

  it('renders assistant message with "⛵ Vela" label', () => {
    const msg: Message = { role: 'assistant', content: 'Hi there' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⛵ Vela');
    expect(frame).toContain('Hi there');
  });

  it('renders system message with "⚙ System" label', () => {
    const msg: Message = { role: 'system', content: 'Context reset' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⚙ System');
    expect(frame).toContain('Context reset');
  });

  it('renders tool calls when toolCalls present', () => {
    const msg: Message = {
      role: 'assistant',
      content: 'Let me read that.',
      toolCalls: [
        { name: 'Read', status: 'complete', result: 'file contents' },
      ],
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⛵ Vela');
    expect(frame).toContain('Let me read that.');
    expect(frame).toContain('Read');
    expect(frame).toContain('file contents');
  });

  it('renders bordered card (round border style)', () => {
    const msg: Message = { role: 'user', content: 'Test' };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame()!;
    // Round border uses ╭ and ╮ for top corners
    expect(frame).toContain('╭');
    expect(frame).toContain('╮');
  });
});

// ── ToolCallBlock ──────────────────────────────────────────────

describe('ToolCallBlock', () => {
  it('renders running state with tool name and 🔧 icon', () => {
    const tc: ToolCallInfo = { name: 'Read', status: 'running' };
    const { lastFrame } = render(<ToolCallBlock toolCall={tc} />);
    const frame = lastFrame()!;
    expect(frame).toContain('🔧');
    expect(frame).toContain('Read');
  });

  it('renders complete state with result text', () => {
    const tc: ToolCallInfo = {
      name: 'Write',
      status: 'complete',
      result: 'File written successfully',
    };
    const { lastFrame } = render(<ToolCallBlock toolCall={tc} />);
    const frame = lastFrame()!;
    expect(frame).toContain('✅');
    expect(frame).toContain('Write');
    expect(frame).toContain('File written successfully');
  });

  it('renders blocked state with gate code', () => {
    const tc: ToolCallInfo = {
      name: 'Write',
      status: 'blocked',
      gateCode: 'VK-04',
    };
    const { lastFrame } = render(<ToolCallBlock toolCall={tc} />);
    const frame = lastFrame()!;
    expect(frame).toContain('⛔');
    expect(frame).toContain('Write');
    expect(frame).toContain('VK-04');
  });

  it('truncates result to 3 lines when long', () => {
    const longResult = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const tc: ToolCallInfo = {
      name: 'Read',
      status: 'complete',
      result: longResult,
    };
    const { lastFrame } = render(<ToolCallBlock toolCall={tc} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 3');
    expect(frame).toContain('…');
    expect(frame).not.toContain('Line 4');
  });

  it('renders error result with error styling', () => {
    const tc: ToolCallInfo = {
      name: 'Write',
      status: 'complete',
      result: 'Permission denied',
      isError: true,
    };
    const { lastFrame } = render(<ToolCallBlock toolCall={tc} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Write');
    expect(frame).toContain('Permission denied');
  });
});

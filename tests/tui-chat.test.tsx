import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MessageList } from '../src/tui/MessageList.js';
import { ChatInput } from '../src/tui/ChatInput.js';
import { ToolStatus } from '../src/tui/ToolStatus.js';

// ── MessageList ────────────────────────────────────────────────────

describe('MessageList', () => {
  it('renders user and assistant messages with correct prefixes', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello there' },
      { role: 'assistant' as const, content: 'Hi, how can I help?' },
    ];
    const { lastFrame } = render(<MessageList messages={messages} />);
    const frame = lastFrame()!;
    expect(frame).toContain('You');
    expect(frame).toContain('Hello there');
    expect(frame).toContain('⛵ Vela');
    expect(frame).toContain('Hi, how can I help?');
  });

  it('renders streaming text below static messages', () => {
    const messages = [
      { role: 'user' as const, content: 'What is 2+2?' },
    ];
    const { lastFrame } = render(
      <MessageList messages={messages} streamingText="The answer is" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('You');
    expect(frame).toContain('What is 2+2?');
    expect(frame).toContain('⛵ Vela');
    expect(frame).toContain('The answer is');
  });

  it('handles empty messages array', () => {
    const { lastFrame } = render(<MessageList messages={[]} />);
    const frame = lastFrame()!;
    // Should render without crashing — no message prefixes present
    expect(frame).not.toContain('You');
    expect(frame).not.toContain('⛵ Vela');
  });

  it('does not render streaming section when streamingText is absent', () => {
    const messages = [
      { role: 'user' as const, content: 'Hi' },
    ];
    const { lastFrame } = render(<MessageList messages={messages} />);
    const frame = lastFrame()!;
    expect(frame).toContain('You');
    expect(frame).toContain('Hi');
    // Only the user bubble — no streaming Vela line
    // Count occurrences of Vela label — should be 0 (no streaming text)
    const velaMatches = frame.match(/⛵ Vela/g) || [];
    expect(velaMatches.length).toBe(0);
  });
});

// ── ChatInput ──────────────────────────────────────────────────────

describe('ChatInput', () => {
  it('renders ❯ prompt prefix', () => {
    const { lastFrame } = render(<ChatInput onSubmit={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain('❯');
  });

  it('renders placeholder text when empty', () => {
    const { lastFrame } = render(<ChatInput onSubmit={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain('메시지를 입력하세요');
  });
});

// ── ToolStatus ─────────────────────────────────────────────────────

describe('ToolStatus', () => {
  it('shows spinner and tool name when running', () => {
    const { lastFrame } = render(
      <ToolStatus toolName="read_file" isRunning={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Running tool: read_file');
  });

  it('renders nothing when not running', () => {
    const { lastFrame } = render(
      <ToolStatus toolName="read_file" isRunning={false} />,
    );
    const frame = lastFrame()!;
    expect(frame).toBe('');
  });

  it('renders nothing when toolName is absent', () => {
    const { lastFrame } = render(<ToolStatus isRunning={true} />);
    const frame = lastFrame()!;
    expect(frame).toBe('');
  });
});

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { theme } from './theme.js';

// ── Command definitions with subcommands ───────────────────────

interface CommandDef {
  desc: string;
  subs?: Record<string, string>;
}

const COMMANDS: Record<string, CommandDef> = {
  '/help':       { desc: 'Help' },
  '/quit':       { desc: 'Exit' },
  '/clear':      { desc: 'Clear' },
  '/fresh':      { desc: 'Reset ctx' },
  '/sessions':   { desc: 'Sessions' },
  '/model':      { desc: 'Model', subs: { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' } },
  '/budget':     { desc: 'Budget', subs: { '<$>': 'Set limit' } },
  '/auto':       { desc: 'Auto-route' },
  '/start':      { desc: '🚀 Pipeline', subs: { '<task>': 'Description', '--scale': 'S/M/L' } },
  '/state':      { desc: '📋 State' },
  '/transition': { desc: '⏭️  Next' },
  '/cancel':     { desc: '🛑 Cancel' },
};

const COMMAND_NAMES = Object.keys(COMMANDS);
const MAX_HISTORY = 50;

// ── Props ──────────────────────────────────────────────────────

export interface ChatInputProps {
  onSubmit: (text: string) => void;
  isStreaming?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function ChatInput({ onSubmit, isStreaming }: ChatInputProps) {
  const [submitCount, setSubmitCount] = useState(0);
  const [currentInput, setCurrentInput] = useState('');

  // Input history (persists across re-renders, not across sessions)
  const historyRef = useRef<string[]>([]);
  // -1 = not browsing history, 0 = most recent, 1 = second most recent, etc.
  const historyIndexRef = useRef(-1);
  // Stash the in-progress input when user starts browsing history
  const stashRef = useRef('');

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) return;

      // Push to history (avoid consecutive duplicates)
      const h = historyRef.current;
      if (h.length === 0 || h[h.length - 1] !== value) {
        h.push(value);
        if (h.length > MAX_HISTORY) h.shift();
      }
      // Reset history browsing
      historyIndexRef.current = -1;
      stashRef.current = '';

      onSubmit(value);
      setCurrentInput('');
      setSubmitCount((c) => c + 1);
    },
    [onSubmit],
  );

  const handleChange = useCallback((value: string) => {
    setCurrentInput(value);
  }, []);

  // Arrow key history navigation
  useInput((_input, key) => {
    if (!key.upArrow && !key.downArrow) return;

    const h = historyRef.current;
    if (h.length === 0) return;

    if (key.upArrow) {
      if (historyIndexRef.current === -1) {
        // Entering history — stash current input
        stashRef.current = currentInput;
        historyIndexRef.current = 0;
      } else if (historyIndexRef.current < h.length - 1) {
        historyIndexRef.current++;
      } else {
        return; // already at oldest
      }
      const entry = h[h.length - 1 - historyIndexRef.current]!;
      setCurrentInput(entry);
      setSubmitCount((c) => c + 1); // remount TextInput with new defaultValue
    }

    if (key.downArrow) {
      if (historyIndexRef.current <= 0) {
        // Return to stashed input
        historyIndexRef.current = -1;
        setCurrentInput(stashRef.current);
        setSubmitCount((c) => c + 1);
      } else {
        historyIndexRef.current--;
        const entry = h[h.length - 1 - historyIndexRef.current]!;
        setCurrentInput(entry);
        setSubmitCount((c) => c + 1);
      }
    }
  });

  const preview = useMemo(() => {
    const input = currentInput.trimStart();
    if (!input.startsWith('/')) return null;

    const parts = input.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();

    if (parts.length >= 1 && COMMANDS[cmd]?.subs) {
      return {
        type: 'subs' as const,
        command: cmd,
        subs: Object.entries(COMMANDS[cmd]!.subs!),
      };
    }

    if (cmd === '/') {
      return { type: 'commands' as const, matches: COMMAND_NAMES };
    }
    const matches = COMMAND_NAMES.filter((c) => c.startsWith(cmd) && c !== cmd);
    return matches.length > 0 ? { type: 'commands' as const, matches } : null;
  }, [currentInput]);

  const hintLine = useMemo(() => {
    if (!preview) return null;

    if (preview.type === 'subs') {
      const parts = preview.subs.map(([k, v]) => `${k} ${v}`);
      return `${preview.command} → ${parts.join('  ')}`;
    }

    return preview.matches
      .map((cmd) => `${cmd} ${COMMANDS[cmd]!.desc}`)
      .join('   ');
  }, [preview]);

  return (
    <Box flexDirection="column">
      {hintLine && (
        <Box paddingLeft={2}>
          <Text color={theme.dim} wrap="truncate-end">{hintLine}</Text>
        </Box>
      )}

      <Box>
        <Text bold color={isStreaming ? theme.dim : theme.success}>
          {isStreaming ? '⏳ ' : '❯ '}
        </Text>
        <TextInput
          key={submitCount}
          defaultValue={currentInput}
          placeholder="메시지를 입력하세요... ( / 명령어 )"
          onSubmit={handleSubmit}
          onChange={handleChange}
          suggestions={COMMAND_NAMES}
        />
      </Box>
    </Box>
  );
}

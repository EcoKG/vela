import React from 'react';
import { Box, Text } from 'ink';
import type { AutoModeState } from '../auto-mode.js';
import { theme } from './theme.js';

interface AutoModeStatusProps {
  state: AutoModeState | null;
}

const STATUS_COLORS: Record<string, string | undefined> = {
  running: theme.success,
  paused: theme.highlight,
  idle: theme.dim,
  completed: theme.accent,
  cancelled: theme.error,
};

export function AutoModeStatus({ state }: AutoModeStatusProps) {
  if (!state) {
    return (
      <Box borderStyle="single" borderColor={theme.dim} paddingX={1} flexDirection="column">
        <Text color={theme.dim} dimColor>🤖 Auto-mode: not active</Text>
      </Box>
    );
  }

  const color = STATUS_COLORS[state.status] || theme.text;

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1} flexDirection="column">
      <Text color={color} bold>🤖 Auto-mode</Text>
      <Box>
        <Text color={theme.text}>Status: </Text>
        <Text color={color} bold>{state.status.toUpperCase()}</Text>
      </Box>
      <Box>
        <Text color={theme.text}>Progress: </Text>
        <Text color={theme.dim}>task {state.current_index + 1} of {state.task_ids.length}</Text>
      </Box>
      {state.blocker && (
        <Box>
          <Text color={theme.error} bold>⚠ Blocker: </Text>
          <Text color={theme.error}>{state.blocker.reason}</Text>
        </Box>
      )}
    </Box>
  );
}

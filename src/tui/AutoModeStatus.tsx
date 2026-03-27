import React from 'react';
import { Box, Text } from 'ink';
import type { AutoModeState } from '../auto-mode.js';

interface AutoModeStatusProps {
  state: AutoModeState | null;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'green',
  paused: 'yellow',
  idle: 'gray',
  completed: 'cyan',
  cancelled: 'red',
};

export function AutoModeStatus({ state }: AutoModeStatusProps) {
  if (!state) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="gray" dimColor>🤖 Auto-mode: not active</Text>
      </Box>
    );
  }

  const color = STATUS_COLORS[state.status] || 'white';

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1} flexDirection="column">
      <Text color={color} bold>🤖 Auto-mode</Text>
      <Box>
        <Text color="white">Status: </Text>
        <Text color={color} bold>{state.status.toUpperCase()}</Text>
      </Box>
      <Box>
        <Text color="white">Progress: </Text>
        <Text color="gray">task {state.current_index + 1} of {state.task_ids.length}</Text>
      </Box>
      {state.blocker && (
        <Box>
          <Text color="red" bold>⚠ Blocker: </Text>
          <Text color="red">{state.blocker.reason}</Text>
        </Box>
      )}
    </Box>
  );
}

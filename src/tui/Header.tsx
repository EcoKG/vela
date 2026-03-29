import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export function Header() {
  const cols = process.stdout.columns ?? 80;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.header.brand} bold>⛵ Vela</Text>
        <Text color={theme.dim}> — AI Development Agent</Text>
      </Box>
      <Text color={theme.header.separator}>{'─'.repeat(Math.min(cols, 120))}</Text>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface HeaderProps {
  /** Width of the separator line. Defaults to 40. */
  width?: number;
}

export function Header({ width }: HeaderProps = {}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.header.brand} bold>⛵ Vela</Text>
        <Text color={theme.highlight}> ✦ </Text>
        <Text color={theme.dim}>Development Governance</Text>
      </Box>
      <Text color={theme.header.separator} dimColor>{'─'.repeat(width ?? 40)}</Text>
    </Box>
  );
}

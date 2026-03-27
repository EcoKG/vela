import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>⛵ Vela</Text>
        <Text color="yellow"> ✦ </Text>
        <Text color="gray">Development Governance</Text>
      </Box>
      <Text color="gray" dimColor>{'─'.repeat(40)}</Text>
    </Box>
  );
}

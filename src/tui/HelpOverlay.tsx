import React from 'react';
import { Box, Text } from 'ink';
import { SHORTCUT_LIST } from './shortcuts.js';

export interface HelpOverlayProps {
  visible: boolean;
}

export function HelpOverlay({ visible }: HelpOverlayProps) {
  if (!visible) return null;

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Text color="cyan" bold>
        ⌨ Keyboard Shortcuts
      </Text>

      {SHORTCUT_LIST.map((s) => (
        <Box key={s.keys}>
          <Text color="yellow">{s.keys.padEnd(12)}</Text>
          <Text color="white">{s.description}</Text>
        </Box>
      ))}

      <Text> </Text>
      <Text color="cyan" bold>
        / Slash Commands
      </Text>
      <Box>
        <Text color="yellow">{'/help'.padEnd(12)}</Text>
        <Text color="white">Show this help overlay</Text>
      </Box>
      <Box>
        <Text color="yellow">{'/quit'.padEnd(12)}</Text>
        <Text color="white">Exit Vela</Text>
      </Box>
      <Box>
        <Text color="yellow">{'/clear'.padEnd(12)}</Text>
        <Text color="white">Clear message history</Text>
      </Box>
      <Box>
        <Text color="yellow">{'/sessions'.padEnd(12)}</Text>
        <Text color="white">List recent sessions</Text>
      </Box>
      <Box>
        <Text color="yellow">{'/model'.padEnd(12)}</Text>
        <Text color="white">Show current model or switch (/model sonnet)</Text>
      </Box>

      <Text> </Text>
      <Text color="gray" italic>
        Press Escape to close
      </Text>
    </Box>
  );
}

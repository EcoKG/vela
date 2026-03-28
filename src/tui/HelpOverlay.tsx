import React from 'react';
import { Box, Text } from 'ink';
import { SHORTCUT_LIST } from './shortcuts.js';
import { theme } from './theme.js';

export interface HelpOverlayProps {
  visible: boolean;
}

export function HelpOverlay({ visible }: HelpOverlayProps) {
  if (!visible) return null;

  return (
    <Box
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={theme.accent} bold>
        ⌨ Keyboard Shortcuts
      </Text>

      {SHORTCUT_LIST.map((s) => (
        <Box key={s.keys}>
          <Text color={theme.highlight}>{s.keys.padEnd(12)}</Text>
          <Text color={theme.text}>{s.description}</Text>
        </Box>
      ))}

      <Text> </Text>
      <Text color={theme.accent} bold>
        / Slash Commands
      </Text>
      <Box>
        <Text color={theme.highlight}>{'/help'.padEnd(12)}</Text>
        <Text color={theme.text}>Show this help overlay</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/quit'.padEnd(12)}</Text>
        <Text color={theme.text}>Exit Vela</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/clear'.padEnd(12)}</Text>
        <Text color={theme.text}>Clear message history</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/sessions'.padEnd(12)}</Text>
        <Text color={theme.text}>List recent sessions</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/model'.padEnd(12)}</Text>
        <Text color={theme.text}>Show current model or switch (/model sonnet)</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/fresh'.padEnd(12)}</Text>
        <Text color={theme.text}>Reset conversation context (summarize and restart)</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/budget'.padEnd(12)}</Text>
        <Text color={theme.text}>Show budget status or set limit (/budget 1.00)</Text>
      </Box>
      <Box>
        <Text color={theme.highlight}>{'/auto'.padEnd(12)}</Text>
        <Text color={theme.text}>Toggle automatic model routing</Text>
      </Box>

      <Text> </Text>
      <Text color={theme.dim} italic>
        Press Escape to close
      </Text>
    </Box>
  );
}

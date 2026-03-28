import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import type { Message } from './MessageList.js';

const ROLE_CONFIG = {
  user: { label: 'You', labelColor: theme.userLabel, borderColor: theme.userBubble },
  assistant: { label: '⛵ Vela', labelColor: theme.velaLabel, borderColor: theme.velaBubble },
  system: { label: '⚙ System', labelColor: theme.dim, borderColor: theme.dim },
} as const;

export function MessageBubble({ message }: { message: Message }) {
  const config = ROLE_CONFIG[message.role];

  return (
    <Box
      borderStyle="round"
      borderColor={config.borderColor}
      paddingX={1}
      flexDirection="column"
      marginBottom={1}
    >
      <Text color={config.labelColor} bold>
        {config.label}
      </Text>
      <Text>{message.content}</Text>
      {message.toolCalls?.map((tc, i) => (
        <ToolCallBlock key={i} toolCall={tc} />
      ))}
    </Box>
  );
}

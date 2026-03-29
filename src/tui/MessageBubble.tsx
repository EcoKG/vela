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
  const isUser = message.role === 'user';

  return (
    <Box
      flexDirection="column"
      marginBottom={0}
      paddingLeft={isUser ? 0 : 0}
    >
      {/* Role label */}
      <Box>
        <Text color={config.labelColor} bold>
          {config.label}
        </Text>
      </Box>

      {/* Content — indented under label */}
      <Box paddingLeft={1}>
        <Text wrap="wrap" color={theme.text}>{message.content}</Text>
      </Box>

      {/* Tool calls */}
      {message.toolCalls?.map((tc, i) => (
        <Box key={i} paddingLeft={1}>
          <ToolCallBlock toolCall={tc} />
        </Box>
      ))}

      {/* Separator line */}
      <Text color={theme.dim}>{''}</Text>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { theme } from './theme.js';

export interface ChatInputProps {
  onSubmit: (text: string) => void;
  /** @deprecated Kept for backward compat — input is never disabled. */
  isDisabled?: boolean;
  /** When true, dims the prompt to indicate streaming is active. */
  isStreaming?: boolean;
}

export function ChatInput({ onSubmit, isStreaming }: ChatInputProps) {
  return (
    <Box>
      <Text bold color={isStreaming ? theme.dim : theme.success}>{isStreaming ? '⏳> ' : '> '}</Text>
      <TextInput
        placeholder="Type a message..."
        onSubmit={onSubmit}
      />
    </Box>
  );
}

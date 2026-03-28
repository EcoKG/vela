import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';

export interface ChatInputProps {
  onSubmit: (text: string) => void;
  isDisabled?: boolean;
}

export function ChatInput({ onSubmit, isDisabled }: ChatInputProps) {
  return (
    <Box>
      <Text bold color="green">{"> "}</Text>
      <TextInput
        placeholder="Type a message..."
        onSubmit={onSubmit}
        isDisabled={isDisabled}
      />
    </Box>
  );
}

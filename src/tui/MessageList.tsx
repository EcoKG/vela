import React from 'react';
import { Box, Static, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface MessageListProps {
  messages: Message[];
  streamingText?: string;
}

export function MessageList({ messages, streamingText }: MessageListProps) {
  return (
    <Box flexDirection="column">
      <Static items={messages}>
        {(msg, index) => (
          <Box key={index}>
            <Text color={msg.role === 'user' ? 'green' : 'cyan'} bold>
              {msg.role === 'user' ? 'You: ' : 'Claude: '}
            </Text>
            <Text>{msg.content}</Text>
          </Box>
        )}
      </Static>
      {streamingText ? (
        <Box>
          <Text color="cyan" bold>Claude: </Text>
          <Text>{streamingText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

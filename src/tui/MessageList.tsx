import React from 'react';
import { Box, Text } from 'ink';
import { ScrollView } from 'ink-scroll-view';
import type { ScrollViewRef } from 'ink-scroll-view';
import { MessageBubble } from './MessageBubble.js';
import type { ToolCallInfo } from './ToolCallBlock.js';
import { theme } from './theme.js';

export type { ScrollViewRef };
export type { ToolCallInfo };

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
}

export interface MessageListProps {
  messages: Message[];
  streamingText?: string;
}

export const MessageList = React.forwardRef<ScrollViewRef, MessageListProps>(
  function MessageList({ messages, streamingText }, ref) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ScrollView ref={ref} flexGrow={1}>
          {messages.map((msg, index) => (
            <MessageBubble key={index} message={msg} />
          ))}
        </ScrollView>
        {streamingText ? (
          <Box>
            <Text color={theme.velaLabel} bold>⛵ Vela: </Text>
            <Text>{streamingText}</Text>
          </Box>
        ) : null}
      </Box>
    );
  },
);

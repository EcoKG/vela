import React, { useRef, useEffect, useImperativeHandle, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { MessageBubble } from './MessageBubble.js';
import type { ToolCallInfo } from './ToolCallBlock.js';
import { theme } from './theme.js';

export type { ToolCallInfo };

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
}

export interface MessageListProps {
  messages: Message[];
  streamingText?: string;
  /** When true and no streamingText yet, shows a "thinking" indicator. */
  isStreaming?: boolean;
  /** Available height in rows for the message area. */
  height?: number;
}

export interface MessageListHandle {
  scrollToBottom: () => void;
}

/**
 * Scrollable message list.
 *
 * Uses a simple scroll offset model:
 * - Total content = messages + streaming indicator
 * - scrollOffset = how many lines from the bottom to shift up
 * - Arrow keys / PageUp/Down navigate
 * - Auto-scrolls to bottom on new messages unless user scrolled up
 */
export const MessageList = React.forwardRef<MessageListHandle, MessageListProps>(
  function MessageList({ messages, streamingText, isStreaming, height = 20 }, ref) {
    const showThinking = isStreaming && !streamingText;

    // Track scroll position: 0 = at bottom (newest), positive = scrolled up
    const scrollOffsetRef = useRef(0);
    const [, forceRender] = React.useState(0);
    // Track whether user has scrolled up (prevents auto-scroll)
    const userScrolledRef = useRef(false);

    const prevMessageCountRef = useRef(messages.length);

    // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
    useEffect(() => {
      if (messages.length > prevMessageCountRef.current) {
        if (!userScrolledRef.current) {
          scrollOffsetRef.current = 0;
        }
      }
      prevMessageCountRef.current = messages.length;
    }, [messages.length]);

    // Also auto-scroll when streaming text updates (if at bottom)
    useEffect(() => {
      if (!userScrolledRef.current) {
        scrollOffsetRef.current = 0;
      }
    }, [streamingText]);

    const scrollToBottom = useCallback(() => {
      scrollOffsetRef.current = 0;
      userScrolledRef.current = false;
      forceRender((c) => c + 1);
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    // Keyboard scroll
    useInput((_input, key) => {
      const pageSize = Math.max(Math.floor(height * 0.75), 1);
      // Total items for scroll clamping
      const totalItems = messages.length + (showThinking || streamingText ? 1 : 0);
      const maxOffset = Math.max(totalItems - 1, 0);

      if (key.upArrow) {
        scrollOffsetRef.current = Math.min(scrollOffsetRef.current + 1, maxOffset);
        userScrolledRef.current = scrollOffsetRef.current > 0;
        forceRender((c) => c + 1);
      } else if (key.downArrow) {
        scrollOffsetRef.current = Math.max(scrollOffsetRef.current - 1, 0);
        userScrolledRef.current = scrollOffsetRef.current > 0;
        forceRender((c) => c + 1);
      } else if (key.pageUp) {
        scrollOffsetRef.current = Math.min(scrollOffsetRef.current + pageSize, maxOffset);
        userScrolledRef.current = true;
        forceRender((c) => c + 1);
      } else if (key.pageDown) {
        scrollOffsetRef.current = Math.max(scrollOffsetRef.current - pageSize, 0);
        userScrolledRef.current = scrollOffsetRef.current > 0;
        forceRender((c) => c + 1);
      }
    });

    // Calculate visible slice
    const allItems = [...messages];
    const totalItems = allItems.length + (showThinking || streamingText ? 1 : 0);

    // Simple approach: show all messages in a column, overflow hidden clips from top
    // scrollOffset determines how many items from the end we skip
    const offset = scrollOffsetRef.current;
    const endIndex = totalItems - offset;
    const startIndex = Math.max(endIndex - height, 0);
    const visibleMessages = allItems.slice(
      startIndex,
      Math.min(endIndex, allItems.length),
    );
    const showStreamingInView = offset === 0;

    return (
      <Box flexDirection="column" height={height} overflow="hidden">
        <Box flexDirection="column" flexGrow={1}>
          {visibleMessages.map((msg, index) => (
            <MessageBubble key={startIndex + index} message={msg} />
          ))}

          {/* Streaming / thinking indicators — only when at bottom */}
          {showStreamingInView && showThinking ? (
            <Box paddingLeft={1}>
              <Text color={theme.velaLabel} bold>⛵ Vela </Text>
              <Spinner label="thinking..." />
            </Box>
          ) : showStreamingInView && streamingText ? (
            <Box paddingLeft={1} flexDirection="column">
              <Text color={theme.velaLabel} bold>⛵ Vela</Text>
              <Text wrap="wrap">{streamingText}</Text>
            </Box>
          ) : null}
        </Box>

        {/* Scroll indicator */}
        {offset > 0 && (
          <Box justifyContent="center">
            <Text color={theme.dim}>↓ {offset} more below · press ↓ or End to scroll down</Text>
          </Box>
        )}
        {startIndex > 0 && offset === 0 ? null : startIndex > 0 ? (
          <Box justifyContent="flex-start">
            <Text color={theme.dim}>↑ {startIndex} more above</Text>
          </Box>
        ) : null}
      </Box>
    );
  },
);

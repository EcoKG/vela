import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface ToolCallInfo {
  name: string;
  status: 'running' | 'complete' | 'blocked';
  result?: string;
  isError?: boolean;
  gateCode?: string;
}

const STATUS_MARKERS: Record<ToolCallInfo['status'], { icon: string; color: string }> = {
  running: { icon: '⏳', color: theme.toolRunning },
  complete: { icon: '✓', color: theme.toolComplete },
  blocked: { icon: '✗', color: theme.toolBlocked },
};

/** Show first line of result, truncated to maxLen. */
function summarizeResult(text: string, maxLen = 60): string {
  const firstLine = text.split('\n')[0] ?? '';
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1) + '…';
}

export function ToolCallBlock({ toolCall }: { toolCall: ToolCallInfo }) {
  const { icon, color } = STATUS_MARKERS[toolCall.status];

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text color={color} bold>{toolCall.name}</Text>
      {toolCall.status === 'blocked' && toolCall.gateCode ? (
        <Text color={theme.toolBlocked}> [{toolCall.gateCode}]</Text>
      ) : null}
      {toolCall.status === 'complete' && toolCall.result ? (
        <Text color={toolCall.isError ? theme.error : theme.dim}> {summarizeResult(toolCall.result)}</Text>
      ) : null}
    </Box>
  );
}

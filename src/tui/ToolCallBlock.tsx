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

const STATUS_ICONS: Record<ToolCallInfo['status'], { icon: string; color: string }> = {
  running: { icon: '🔧', color: theme.toolRunning },
  complete: { icon: '✅', color: theme.toolComplete },
  blocked: { icon: '⛔', color: theme.toolBlocked },
};

/** Truncate multiline text to maxLines, appending an ellipsis indicator. */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n…';
}

export function ToolCallBlock({ toolCall }: { toolCall: ToolCallInfo }) {
  const { icon, color } = STATUS_ICONS[toolCall.status];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text>
          {icon}{' '}
        </Text>
        <Text color={color} bold>
          {toolCall.name}
        </Text>
        {toolCall.status === 'blocked' && toolCall.gateCode ? (
          <Text color={theme.toolBlocked}> [{toolCall.gateCode}]</Text>
        ) : null}
      </Box>
      {toolCall.status === 'complete' && toolCall.result ? (
        <Box marginLeft={2}>
          <Text color={toolCall.isError ? theme.error : theme.dim}>
            {truncateLines(toolCall.result, 3)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

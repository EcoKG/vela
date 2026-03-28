import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';

export interface GateVerdict {
  blocked: boolean;
  code: string;
}

export interface ToolStatusProps {
  toolName?: string;
  isRunning?: boolean;
  gateVerdict?: GateVerdict | null;
}

export function ToolStatus({ toolName, isRunning, gateVerdict }: ToolStatusProps) {
  if (gateVerdict?.blocked) {
    return (
      <Box>
        <Text color="red" bold>⛵ BLOCKED [{gateVerdict.code}]{toolName ? `: ${toolName}` : ''}</Text>
      </Box>
    );
  }

  if (!isRunning || !toolName) {
    return null;
  }

  return (
    <Box>
      <Spinner label={`Running tool: ${toolName}`} />
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface GovernanceStatusProps {
  mode?: string | null;
  consecutiveBlocks?: number;
  budgetLimit?: number;
}

const MODE_COLORS: Record<string, string> = {
  execute: theme.success,
  read: theme.highlight,
};

export function GovernanceStatus({ mode, consecutiveBlocks = 0, budgetLimit }: GovernanceStatusProps) {
  if (!mode) {
    return null;
  }

  const color = MODE_COLORS[mode] || theme.text;

  return (
    <Box>
      <Text color={theme.dim}>⛵ Mode: </Text>
      <Text color={color} bold>{mode}</Text>
      {consecutiveBlocks > 0 && (
        <>
          <Text color={theme.dim}> │ Blocks: </Text>
          <Text color={theme.error} bold>{consecutiveBlocks}</Text>
          {budgetLimit != null && (
            <Text color={theme.dim}>/{budgetLimit}</Text>
          )}
        </>
      )}
    </Box>
  );
}

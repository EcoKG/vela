import React from 'react';
import { Box, Text } from 'ink';

export interface GovernanceStatusProps {
  mode?: string | null;
  consecutiveBlocks?: number;
  budgetLimit?: number;
}

const MODE_COLORS: Record<string, string> = {
  execute: 'green',
  read: 'yellow',
};

export function GovernanceStatus({ mode, consecutiveBlocks = 0, budgetLimit }: GovernanceStatusProps) {
  if (!mode) {
    return null;
  }

  const color = MODE_COLORS[mode] || 'white';

  return (
    <Box>
      <Text color="gray">⛵ Mode: </Text>
      <Text color={color} bold>{mode}</Text>
      {consecutiveBlocks > 0 && (
        <>
          <Text color="gray"> │ Blocks: </Text>
          <Text color="red" bold>{consecutiveBlocks}</Text>
          {budgetLimit != null && (
            <Text color="gray">/{budgetLimit}</Text>
          )}
        </>
      )}
    </Box>
  );
}

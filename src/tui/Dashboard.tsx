import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface DashboardProps {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: { inputCost: number; outputCost: number; totalCost: number };
  model: string;
  pipelineMode?: string | null;
  sessionId?: string | null;
  sessionTitle?: string | null;
  budgetLimit?: number | null;
  budgetSpent?: number;
  budgetRemaining?: number;
  budgetPercentage?: number;
  budgetWarning?: boolean;
  budgetBlocked?: boolean;
  routedModel?: string | null;
  providerType?: 'api' | 'cli';
}

export function Dashboard({
  inputTokens,
  outputTokens,
  totalTokens,
  estimatedCost,
  model,
  pipelineMode,
  sessionId,
  sessionTitle,
  budgetLimit,
  budgetSpent = 0,
  budgetRemaining = 0,
  budgetPercentage = 0,
  budgetWarning = false,
  budgetBlocked = false,
  routedModel,
  providerType,
}: DashboardProps) {
  // Don't render until first response produces tokens
  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  const hasCostBreakdown = estimatedCost.inputCost > 0 || estimatedCost.outputCost > 0;

  return (
    <Box borderStyle="single" borderColor={theme.dashboard.border} paddingX={1} flexDirection="column">
      <Text color={theme.dashboard.title} bold>📊 Dashboard</Text>

      <Box>
        <Text color={theme.text}>Tokens: </Text>
        <Text color={theme.accent}>{inputTokens}</Text>
        <Text color={theme.dim}> in / </Text>
        <Text color={theme.accent}>{outputTokens}</Text>
        <Text color={theme.dim}> out / </Text>
        <Text color={theme.accent}>{totalTokens}</Text>
        <Text color={theme.dim}> total</Text>
      </Box>

      <Box>
        <Text color={theme.text}>Cost: </Text>
        <Text color={theme.success}>${estimatedCost.totalCost.toFixed(4)}</Text>
        {hasCostBreakdown && (
          <Text color={theme.dim}> (in: ${estimatedCost.inputCost.toFixed(4)} / out: ${estimatedCost.outputCost.toFixed(4)})</Text>
        )}
      </Box>

      {budgetLimit != null && (
        <Box>
          <Text color={theme.text}>Budget: </Text>
          <Text color={budgetBlocked ? theme.error : budgetWarning ? theme.highlight : theme.success}>
            ${budgetSpent.toFixed(4)} / ${budgetLimit.toFixed(4)} ({Math.round(budgetPercentage * 100)}% used)
          </Text>
          <Text color={budgetBlocked ? theme.error : budgetWarning ? theme.highlight : theme.success}>
            {' '}[${budgetRemaining.toFixed(4)} remaining]
          </Text>
          {budgetBlocked && <Text color={theme.error}> ⛔ BLOCKED</Text>}
          {budgetWarning && !budgetBlocked && <Text color={theme.highlight}> ⚠️</Text>}
        </Box>
      )}

      <Box>
        <Text color={theme.text}>Model: </Text>
        <Text color={theme.accent}>{model}</Text>
      </Box>

      {providerType != null && (
        <Box>
          <Text color={theme.text}>Provider: </Text>
          <Text color={providerType === 'cli' ? theme.highlight : theme.accent}>
            {providerType === 'cli' ? 'Claude Code CLI' : 'API'}
          </Text>
        </Box>
      )}

      {routedModel != null && routedModel !== model && (
        <Box>
          <Text color={theme.text}>Auto-routed: </Text>
          <Text color={theme.highlight}>{routedModel}</Text>
        </Box>
      )}

      {pipelineMode != null && (
        <Box>
          <Text color={theme.text}>Pipeline: </Text>
          <Text color={theme.highlight}>{pipelineMode}</Text>
        </Box>
      )}

      {sessionId != null && (
        <Box>
          <Text color={theme.text}>Session: </Text>
          <Text color={theme.accent}>{sessionTitle || sessionId}</Text>
        </Box>
      )}
    </Box>
  );
}

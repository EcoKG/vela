import React from 'react';
import { Box, Text } from 'ink';

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
    <Box borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column">
      <Text color="magenta" bold>📊 Dashboard</Text>

      <Box>
        <Text color="white">Tokens: </Text>
        <Text color="cyan">{inputTokens}</Text>
        <Text color="gray"> in / </Text>
        <Text color="cyan">{outputTokens}</Text>
        <Text color="gray"> out / </Text>
        <Text color="cyan">{totalTokens}</Text>
        <Text color="gray"> total</Text>
      </Box>

      <Box>
        <Text color="white">Cost: </Text>
        <Text color="green">${estimatedCost.totalCost.toFixed(4)}</Text>
        {hasCostBreakdown && (
          <Text color="gray"> (in: ${estimatedCost.inputCost.toFixed(4)} / out: ${estimatedCost.outputCost.toFixed(4)})</Text>
        )}
      </Box>

      {budgetLimit != null && (
        <Box>
          <Text color="white">Budget: </Text>
          <Text color={budgetBlocked ? 'red' : budgetWarning ? 'yellow' : 'green'}>
            ${budgetSpent.toFixed(4)} / ${budgetLimit.toFixed(4)} ({Math.round(budgetPercentage * 100)}% used)
          </Text>
          <Text color={budgetBlocked ? 'red' : budgetWarning ? 'yellow' : 'green'}>
            {' '}[${budgetRemaining.toFixed(4)} remaining]
          </Text>
          {budgetBlocked && <Text color="red"> ⛔ BLOCKED</Text>}
          {budgetWarning && !budgetBlocked && <Text color="yellow"> ⚠️</Text>}
        </Box>
      )}

      <Box>
        <Text color="white">Model: </Text>
        <Text color="cyan">{model}</Text>
      </Box>

      {providerType != null && (
        <Box>
          <Text color="white">Provider: </Text>
          <Text color={providerType === 'cli' ? 'yellow' : 'cyan'}>
            {providerType === 'cli' ? 'Claude Code CLI' : 'API'}
          </Text>
        </Box>
      )}

      {routedModel != null && routedModel !== model && (
        <Box>
          <Text color="white">Auto-routed: </Text>
          <Text color="yellow">{routedModel}</Text>
        </Box>
      )}

      {pipelineMode != null && (
        <Box>
          <Text color="white">Pipeline: </Text>
          <Text color="yellow">{pipelineMode}</Text>
        </Box>
      )}

      {sessionId != null && (
        <Box>
          <Text color="white">Session: </Text>
          <Text color="cyan">{sessionTitle || sessionId}</Text>
        </Box>
      )}
    </Box>
  );
}

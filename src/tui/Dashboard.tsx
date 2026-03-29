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
  /** Current working directory / workspace path. */
  workspacePath?: string;
}

/** Shorten a path for display: ~/foo/bar or last 2 segments if too long. */
function shortenPath(p: string, maxLen = 28): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  let display = p;
  if (home && display.startsWith(home)) {
    display = '~' + display.slice(home.length);
  }
  if (display.length > maxLen) {
    const segments = display.split('/');
    display = '…/' + segments.slice(-2).join('/');
  }
  return display;
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
  workspacePath,
}: DashboardProps) {
  const hasCostBreakdown = estimatedCost.inputCost > 0 || estimatedCost.outputCost > 0;
  const hasTokens = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;

  return (
    <Box borderStyle="single" borderColor={theme.dashboard.border} paddingX={1} flexDirection="column">
      <Text color={theme.dashboard.title} bold>📊 Dashboard</Text>

      {/* Workspace */}
      {workspacePath && (
        <Box>
          <Text color={theme.dim}>📁 </Text>
          <Text color={theme.accent}>{shortenPath(workspacePath)}</Text>
        </Box>
      )}

      {/* Model */}
      <Box>
        <Text color={theme.dim}>🤖 </Text>
        <Text color={theme.accent}>{model}</Text>
      </Box>

      {/* Provider */}
      {providerType != null && (
        <Box>
          <Text color={theme.dim}>🔌 </Text>
          <Text color={providerType === 'cli' ? theme.highlight : theme.accent}>
            {providerType === 'cli' ? 'Claude CLI' : 'API'}
          </Text>
        </Box>
      )}

      {/* Pipeline */}
      {pipelineMode != null && (
        <Box>
          <Text color={theme.dim}>⚙️  </Text>
          <Text color={theme.highlight}>{pipelineMode}</Text>
        </Box>
      )}

      {/* Tokens */}
      {hasTokens && (
        <Box>
          <Text color={theme.dim}>📈 </Text>
          <Text color={theme.accent}>{inputTokens}</Text>
          <Text color={theme.dim}> / </Text>
          <Text color={theme.accent}>{outputTokens}</Text>
          <Text color={theme.dim}> tok</Text>
        </Box>
      )}

      {/* Cost */}
      {hasTokens && (
        <Box>
          <Text color={theme.dim}>💰 </Text>
          <Text color={theme.success}>${estimatedCost.totalCost.toFixed(4)}</Text>
          {hasCostBreakdown && (
            <Text color={theme.dim}> ({estimatedCost.inputCost.toFixed(3)}+{estimatedCost.outputCost.toFixed(3)})</Text>
          )}
        </Box>
      )}

      {/* Budget */}
      {budgetLimit != null && (
        <Box>
          <Text color={theme.dim}>🎯 </Text>
          <Text color={budgetBlocked ? theme.error : budgetWarning ? theme.highlight : theme.success}>
            ${budgetSpent.toFixed(3)}/${budgetLimit.toFixed(2)} ({Math.round(budgetPercentage * 100)}%)
          </Text>
          {budgetBlocked && <Text color={theme.error}> ⛔</Text>}
          {budgetWarning && !budgetBlocked && <Text color={theme.highlight}> ⚠️</Text>}
        </Box>
      )}

      {/* Auto-routed model */}
      {routedModel != null && routedModel !== model && (
        <Box>
          <Text color={theme.dim}>🔄 </Text>
          <Text color={theme.highlight}>{routedModel}</Text>
        </Box>
      )}

      {/* Session */}
      {sessionId != null && (
        <Box>
          <Text color={theme.dim}>📝 </Text>
          <Text color={theme.accent}>{sessionTitle || sessionId.slice(0, 8)}</Text>
        </Box>
      )}
    </Box>
  );
}

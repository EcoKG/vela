import React from 'react';
import { Box, Text } from 'ink';
import type { Pipeline } from '../state.js';
import { theme } from './theme.js';

interface PipelinePanelProps {
  pipeline: Pipeline | null;
}

function buildProgressBar(completed: number, total: number, width: number = 20): string {
  if (total === 0) return `[${'─'.repeat(width)}]`;
  const filled = Math.round((completed / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export function PipelinePanel({ pipeline }: PipelinePanelProps) {
  if (!pipeline) {
    return (
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
        <Text color={theme.dim} dimColor>🧭 No active pipeline</Text>
      </Box>
    );
  }

  const completedCount = pipeline.completed_steps.length;
  const totalSteps = pipeline.steps.length;
  const bar = buildProgressBar(completedCount, totalSteps);

  return (
    <Box borderStyle="single" borderColor={theme.accent} paddingX={1} flexDirection="column">
      <Text color={theme.accent} bold>🧭 Pipeline</Text>
      <Box marginTop={0}>
        <Text color={theme.text}>Type: </Text>
        <Text color={theme.accent}>{pipeline.pipeline_type}</Text>
        <Text color={theme.text}>  Scale: </Text>
        <Text color={theme.accent}>{pipeline.scale}</Text>
      </Box>
      <Box>
        <Text color={theme.text}>Step: </Text>
        <Text color={theme.highlight} bold>{pipeline.current_step}</Text>
      </Box>
      <Box>
        <Text color={theme.text}>Progress: </Text>
        <Text color={theme.success}>{bar}</Text>
        <Text color={theme.dim}> {completedCount}/{totalSteps}</Text>
      </Box>
    </Box>
  );
}

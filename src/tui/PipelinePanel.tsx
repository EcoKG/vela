import React from 'react';
import { Box, Text } from 'ink';
import type { Pipeline } from '../state.js';

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
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="gray" dimColor>🧭 No active pipeline</Text>
      </Box>
    );
  }

  const completedCount = pipeline.completed_steps.length;
  const totalSteps = pipeline.steps.length;
  const bar = buildProgressBar(completedCount, totalSteps);

  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1} flexDirection="column">
      <Text color="blue" bold>🧭 Pipeline</Text>
      <Box marginTop={0}>
        <Text color="white">Type: </Text>
        <Text color="cyan">{pipeline.pipeline_type}</Text>
        <Text color="white">  Scale: </Text>
        <Text color="cyan">{pipeline.scale}</Text>
      </Box>
      <Box>
        <Text color="white">Step: </Text>
        <Text color="yellow" bold>{pipeline.current_step}</Text>
      </Box>
      <Box>
        <Text color="white">Progress: </Text>
        <Text color="green">{bar}</Text>
        <Text color="gray"> {completedCount}/{totalSteps}</Text>
      </Box>
    </Box>
  );
}

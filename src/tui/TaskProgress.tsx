import React from 'react';
import { Box, Text } from 'ink';
import type { Task } from '../state.js';
import { theme } from './theme.js';

interface TaskProgressProps {
  tasks: Task[];
}

function buildProgressBar(completed: number, total: number, width: number = 20): string {
  if (total === 0) return `[${'─'.repeat(width)}]`;
  const filled = Math.round((completed / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export function TaskProgress({ tasks }: TaskProgressProps) {
  if (tasks.length === 0) {
    return (
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexDirection="column">
        <Text color={theme.dim} dimColor>📋 No tasks</Text>
      </Box>
    );
  }

  const completed = tasks.filter((t) => t.status === 'complete' || t.status === 'completed').length;
  const total = tasks.length;
  const bar = buildProgressBar(completed, total);

  return (
    <Box borderStyle="single" borderColor={theme.success} paddingX={1} flexDirection="column">
      <Text color={theme.success} bold>📋 Tasks</Text>
      <Box>
        <Text color={theme.text}>{completed}/{total} tasks completed</Text>
      </Box>
      <Box>
        <Text color={theme.success}>{bar}</Text>
        <Text color={theme.dim}> {Math.round((completed / total) * 100)}%</Text>
      </Box>
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { join } from 'path';

import { Header } from './Header.js';
import { theme } from './theme.js';
import { PipelinePanel } from './PipelinePanel.js';
import { TaskProgress } from './TaskProgress.js';
import { AutoModeStatus } from './AutoModeStatus.js';

import type { Pipeline, Task } from '../state.js';
import type { AutoModeState } from '../auto-mode.js';

interface AppProps {
  exitOnQ?: boolean;
  velaDir?: string;
}

export function App({ exitOnQ = true, velaDir }: AppProps) {
  const { exit } = useApp();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [autoMode, setAutoMode] = useState<AutoModeState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useInput((input, _key) => {
    if (exitOnQ && input === 'q') {
      exit();
    }
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const { openStateDb, listTasks: listTasksFn } = await import('../state.js');
      const { getPipelineState } = await import('../pipeline.js');
      const { loadAutoModeState } = await import('../auto-mode.js');

      const db = openStateDb(velaDir);
      try {
        setPipeline(getPipelineState(db));
        setTasks(listTasksFn(db));
      } finally {
        db.close();
      }

      if (velaDir) {
        setAutoMode(loadAutoModeState(velaDir));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color={theme.error}>Error loading data: {error}</Text>
        <Text color={theme.dim} dimColor>Press q to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header />
      <PipelinePanel pipeline={pipeline} />
      <TaskProgress tasks={tasks} />
      <AutoModeStatus state={autoMode} />
      <Box marginTop={1}>
        <Text color={theme.dim} dimColor>Press q to exit</Text>
      </Box>
    </Box>
  );
}

export function runTui(options?: { exitOnQ?: boolean; velaDir?: string }) {
  const instance = render(
    <App exitOnQ={options?.exitOnQ ?? true} velaDir={options?.velaDir} />
  );
  return instance;
}

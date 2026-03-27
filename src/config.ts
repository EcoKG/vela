import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Vela project configuration shape.
 */
export interface VelaConfig {
  version: string;
  pipeline: {
    default: string;
    scales: string[];
  };
}

/**
 * Returns the default Vela configuration for a freshly-initialized project.
 */
export function getDefaultConfig(): VelaConfig {
  return {
    version: '1.0',
    pipeline: {
      default: 'standard',
      scales: ['trivial', 'quick', 'standard'],
    },
  };
}

/**
 * Walks up from `startDir` looking for a `.vela/` directory.
 * Returns the directory that contains `.vela/`, or null if none found
 * (stops at the filesystem root).
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, '.vela');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      return null;
    }
    dir = parent;
  }
}

/**
 * Reads and parses `.vela/config.json` from the given project root.
 * Returns null when the file is missing or contains invalid JSON.
 */
export function readConfig(projectRoot: string): VelaConfig | null {
  const configPath = path.join(projectRoot, '.vela', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as VelaConfig;
  } catch {
    return null;
  }
}

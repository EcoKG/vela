import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  TOOL_DEFINITIONS,
  executeRead,
  executeWrite,
  executeEdit,
  executeBash,
  executeTool,
  executeAsyncBash,
  executeBashJobStatus,
  executeBashJobKill,
  executeToolsParallel,
  _getJobsForTesting,
  runToolLoop,
} from '../src/tool-engine.js';
import { RetryBudget } from '../src/governance/retry-budget.js';
import type { Message, ToolUseBlock, TextBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';

// ── Temp directory management ─────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vela-tool-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────

function tmpPath(name: string): string {
  return path.join(tmpDir, name);
}

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = tmpPath(name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ── TOOL_DEFINITIONS ──────────────────────────────────────────

describe('TOOL_DEFINITIONS', () => {
  it('has exactly 7 tool definitions', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(7);
  });

  it('each tool has name, description, and input_schema with type object', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('contains Read, Write, Edit, Bash, AsyncBash, BashJobStatus, BashJobKill tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(['Read', 'Write', 'Edit', 'Bash', 'AsyncBash', 'BashJobStatus', 'BashJobKill']);
  });
});

// ── executeRead ───────────────────────────────────────────────

describe('executeRead', () => {
  it('reads an existing file and returns its content', async () => {
    const filePath = await writeFixture('hello.txt', 'Hello, World!');
    const result = await executeRead({ path: filePath });
    expect(result).toBe('Hello, World!');
  });

  it('returns error for a missing file', async () => {
    await expect(
      executeRead({ path: tmpPath('nonexistent.txt') }),
    ).rejects.toThrow('File not found');
  });

  it('supports offset (1-indexed) to skip leading lines', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const filePath = await writeFixture('lines.txt', content);
    const result = await executeRead({ path: filePath, offset: 3 });
    expect(result).toBe('line3\nline4\nline5');
  });

  it('supports limit to read a fixed number of lines', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const filePath = await writeFixture('lines.txt', content);
    const result = await executeRead({ path: filePath, limit: 2 });
    expect(result).toBe('line1\nline2');
  });

  it('supports offset + limit together', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const filePath = await writeFixture('lines.txt', content);
    const result = await executeRead({ path: filePath, offset: 2, limit: 2 });
    expect(result).toBe('line2\nline3');
  });
});

// ── executeWrite ──────────────────────────────────────────────

describe('executeWrite', () => {
  it('creates a new file with content', async () => {
    const filePath = tmpPath('new-file.txt');
    const result = await executeWrite({
      path: filePath,
      content: 'Hello!',
    });

    expect(result).toContain('Successfully wrote');
    expect(result).toContain('6 bytes');
    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('Hello!');
  });

  it('creates parent directories automatically', async () => {
    const filePath = tmpPath('a/b/c/deep.txt');
    await executeWrite({ path: filePath, content: 'deep content' });

    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('deep content');
  });

  it('overwrites an existing file', async () => {
    const filePath = await writeFixture('overwrite.txt', 'original');
    await executeWrite({ path: filePath, content: 'replaced' });

    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('replaced');
  });
});

// ── executeEdit ───────────────────────────────────────────────

describe('executeEdit', () => {
  it('replaces exact match in file', async () => {
    const filePath = await writeFixture('edit.txt', 'foo bar baz');
    const result = await executeEdit({
      path: filePath,
      old_text: 'bar',
      new_text: 'QUX',
    });

    expect(result).toContain('Successfully edited');
    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('foo QUX baz');
  });

  it('returns error when old_text is not found', async () => {
    const filePath = await writeFixture('edit.txt', 'foo bar baz');
    await expect(
      executeEdit({
        path: filePath,
        old_text: 'MISSING',
        new_text: 'nope',
      }),
    ).rejects.toThrow('old_text not found');
  });

  it('returns error for a missing file', async () => {
    await expect(
      executeEdit({
        path: tmpPath('nonexistent.txt'),
        old_text: 'a',
        new_text: 'b',
      }),
    ).rejects.toThrow('File not found');
  });

  it('handles multi-line old_text with exact whitespace', async () => {
    const filePath = await writeFixture(
      'multiline.txt',
      'line1\n  line2\nline3',
    );
    const result = await executeEdit({
      path: filePath,
      old_text: 'line1\n  line2',
      new_text: 'replaced1\n  replaced2',
    });

    expect(result).toContain('Successfully edited');
    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('replaced1\n  replaced2\nline3');
  });
});

// ── executeBash ───────────────────────────────────────────────

describe('executeBash', () => {
  it('captures stdout from a successful command', () => {
    const result = executeBash({ command: 'echo "hello world"' });
    expect(result.trim()).toBe('hello world');
  });

  it('captures stderr and exit code for a failing command', () => {
    const result = executeBash({ command: 'echo "err msg" >&2; exit 42' });
    expect(result).toContain('err msg');
    expect(result).toContain('Exit code: 42');
  });

  it('returns combined stdout + stderr for failing commands', () => {
    const result = executeBash({
      command: 'echo "out"; echo "err" >&2; exit 1',
    });
    expect(result).toContain('out');
    expect(result).toContain('err');
    expect(result).toContain('Exit code: 1');
  });

  it('handles command timeout gracefully', () => {
    const result = executeBash({
      command: 'sleep 30',
      timeout: 1,
    });
    expect(result).toContain('timed out');
  });

  it('truncates output exceeding 50KB', () => {
    // Generate > 50KB of output (each line ~10 chars)
    const result = executeBash({
      command: 'yes "abcdefghij" | head -n 6000',
    });
    expect(result).toContain('[Output truncated');
  });
});

// ── executeTool dispatcher ────────────────────────────────────

describe('executeTool', () => {
  it('routes Read to executeRead', async () => {
    const filePath = await writeFixture('dispatch-read.txt', 'dispatch test');
    const { result, is_error } = await executeTool('Read', { path: filePath });
    expect(is_error).toBe(false);
    expect(result).toBe('dispatch test');
  });

  it('routes Write to executeWrite', async () => {
    const filePath = tmpPath('dispatch-write.txt');
    const { result, is_error } = await executeTool('Write', {
      path: filePath,
      content: 'written via dispatch',
    });
    expect(is_error).toBe(false);
    expect(result).toContain('Successfully wrote');
  });

  it('routes Edit to executeEdit', async () => {
    const filePath = await writeFixture('dispatch-edit.txt', 'alpha beta');
    const { result, is_error } = await executeTool('Edit', {
      path: filePath,
      old_text: 'alpha',
      new_text: 'OMEGA',
    });
    expect(is_error).toBe(false);
    expect(result).toContain('Successfully edited');
  });

  it('routes Bash to executeBash', async () => {
    const { result, is_error } = await executeTool('Bash', {
      command: 'echo "dispatched"',
    });
    expect(is_error).toBe(false);
    expect(result.trim()).toBe('dispatched');
  });

  it('returns is_error: true for unknown tool name', async () => {
    const { result, is_error } = await executeTool('UnknownTool', {});
    expect(is_error).toBe(true);
    expect(result).toContain('Unknown tool');
    expect(result).toContain('UnknownTool');
  });

  it('returns is_error: true when executor throws', async () => {
    const { result, is_error } = await executeTool('Read', {
      path: tmpPath('does-not-exist.txt'),
    });
    expect(is_error).toBe(true);
    expect(result).toContain('File not found');
  });

  it('routes AsyncBash to executeAsyncBash', async () => {
    const { result, is_error } = await executeTool('AsyncBash', {
      command: 'echo "async hello"',
    });
    expect(is_error).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.jobId).toBeTruthy();
    expect(parsed.status).toBe('started');
  });

  it('routes BashJobStatus to executeBashJobStatus', async () => {
    // Start a fast-completing job first
    const startResult = await executeTool('AsyncBash', { command: 'echo done' });
    const { jobId } = JSON.parse(startResult.result);

    // Wait briefly for the process to finish
    await new Promise((r) => setTimeout(r, 200));

    const { result, is_error } = await executeTool('BashJobStatus', { jobId });
    expect(is_error).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.jobId).toBe(jobId);
    expect(['running', 'completed']).toContain(parsed.status);
  });

  it('routes BashJobKill to executeBashJobKill', async () => {
    const startResult = await executeTool('AsyncBash', { command: 'sleep 60' });
    const { jobId } = JSON.parse(startResult.result);

    const { result, is_error } = await executeTool('BashJobKill', { jobId });
    expect(is_error).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('killed');
  });

  it('applies Bash gate rules to AsyncBash', async () => {
    const gateCtx = {
      cwd: tmpDir,
      mode: 'read',
      config: { sandbox: { enabled: true } },
    };
    const { result, is_error } = await executeTool(
      'AsyncBash',
      { command: 'rm -rf /' },
      gateCtx as any,
    );
    expect(is_error).toBe(true);
    expect(result).toContain('BLOCKED');
  });
});

// ── executeAsyncBash ──────────────────────────────────────────

describe('executeAsyncBash', () => {
  afterEach(() => {
    // Clean up any running jobs
    const jobs = _getJobsForTesting();
    for (const [id, job] of jobs) {
      if (job.status === 'running' && job.process) {
        job.process.kill('SIGTERM');
      }
    }
    jobs.clear();
  });

  it('returns a jobId and started status', () => {
    const result = JSON.parse(executeAsyncBash({ command: 'echo hello' }));
    expect(result.jobId).toMatch(/^job_/);
    expect(result.status).toBe('started');
  });

  it('captures stdout from a completed job', async () => {
    const { jobId } = JSON.parse(executeAsyncBash({ command: 'echo "async output"' }));

    // Wait for completion
    await new Promise((r) => setTimeout(r, 300));

    const status = JSON.parse(executeBashJobStatus({ jobId }));
    expect(status.status).toBe('completed');
    expect(status.stdout).toContain('async output');
    expect(status.exitCode).toBe(0);
  });

  it('captures stderr and marks failed jobs', async () => {
    const { jobId } = JSON.parse(executeAsyncBash({ command: 'echo "err" >&2; exit 1' }));

    await new Promise((r) => setTimeout(r, 300));

    const status = JSON.parse(executeBashJobStatus({ jobId }));
    expect(status.status).toBe('failed');
    expect(status.stderr).toContain('err');
    expect(status.exitCode).toBe(1);
  });

  it('kills a running job', async () => {
    const { jobId } = JSON.parse(executeAsyncBash({ command: 'sleep 60' }));

    const killResult = JSON.parse(executeBashJobKill({ jobId }));
    expect(killResult.status).toBe('killed');

    await new Promise((r) => setTimeout(r, 100));

    const status = JSON.parse(executeBashJobStatus({ jobId }));
    expect(status.status).toBe('killed');
  });

  it('returns already-completed status when killing a finished job', async () => {
    const { jobId } = JSON.parse(executeAsyncBash({ command: 'echo done' }));
    await new Promise((r) => setTimeout(r, 300));

    const killResult = JSON.parse(executeBashJobKill({ jobId }));
    expect(killResult.status).toBe('completed');
    expect(killResult.message).toContain('already');
  });

  it('throws for unknown job ID', () => {
    expect(() => executeBashJobStatus({ jobId: 'job_nonexistent' })).toThrow('Unknown job ID');
    expect(() => executeBashJobKill({ jobId: 'job_nonexistent' })).toThrow('Unknown job ID');
  });

  it('handles timeout enforcement', async () => {
    const { jobId } = JSON.parse(executeAsyncBash({ command: 'sleep 30', timeout: 1 }));

    // Wait for timeout (1s) + buffer
    await new Promise((r) => setTimeout(r, 1500));

    const status = JSON.parse(executeBashJobStatus({ jobId }));
    expect(status.status).toBe('timeout');
    expect(status.stderr).toContain('timeout');
  });

  it('generates unique job IDs', () => {
    const result1 = JSON.parse(executeAsyncBash({ command: 'echo 1' }));
    const result2 = JSON.parse(executeAsyncBash({ command: 'echo 2' }));
    expect(result1.jobId).not.toBe(result2.jobId);
  });
});

// ── executeToolsParallel ──────────────────────────────────────

describe('executeToolsParallel', () => {
  function makeToolUseBlock(name: string, input: Record<string, unknown>, id?: string): ToolUseBlock {
    return {
      type: 'tool_use',
      id: id ?? 'toolu_' + Math.random().toString(36).slice(2, 8),
      name,
      input,
    };
  }

  it('returns empty array for no blocks', async () => {
    const results = await executeToolsParallel([]);
    expect(results).toEqual([]);
  });

  it('handles a single block', async () => {
    const block = makeToolUseBlock('Bash', { command: 'echo single' }, 'toolu_single');
    const results = await executeToolsParallel([block]);
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe('toolu_single');
    expect((results[0].content as string).trim()).toBe('single');
  });

  it('executes independent tools in parallel', async () => {
    // Use async I/O tools to demonstrate true parallelism
    // (Bash uses execSync so it blocks the event loop)
    const file1 = await writeFixture('par-read-1.txt', 'content-a');
    const file2 = await writeFixture('par-read-2.txt', 'content-b');

    const block1 = makeToolUseBlock('Read', { path: file1 }, 'toolu_a');
    const block2 = makeToolUseBlock('Read', { path: file2 }, 'toolu_b');
    const block3 = makeToolUseBlock('Bash', { command: 'echo c' }, 'toolu_c');

    const results = await executeToolsParallel([block1, block2, block3]);

    expect(results).toHaveLength(3);
    expect((results[0].content as string)).toBe('content-a');
    expect((results[1].content as string)).toBe('content-b');
    expect((results[2].content as string).trim()).toBe('c');
    // Order preserved
    expect(results[0].tool_use_id).toBe('toolu_a');
    expect(results[1].tool_use_id).toBe('toolu_b');
    expect(results[2].tool_use_id).toBe('toolu_c');
  });

  it('preserves order in results matching input blocks', async () => {
    const block1 = makeToolUseBlock('Bash', { command: 'echo first' }, 'toolu_1');
    const block2 = makeToolUseBlock('Bash', { command: 'echo second' }, 'toolu_2');
    const block3 = makeToolUseBlock('Bash', { command: 'echo third' }, 'toolu_3');

    const results = await executeToolsParallel([block1, block2, block3]);
    expect(results[0].tool_use_id).toBe('toolu_1');
    expect(results[1].tool_use_id).toBe('toolu_2');
    expect(results[2].tool_use_id).toBe('toolu_3');
  });

  it('runs Write/Edit to same file sequentially (no data corruption)', async () => {
    const filePath = await writeFixture('parallel-test.txt', 'original');
    const block1 = makeToolUseBlock('Write', { path: filePath, content: 'step1' }, 'toolu_w1');
    const block2 = makeToolUseBlock('Edit', { path: filePath, old_text: 'step1', new_text: 'step2' }, 'toolu_e1');

    const results = await executeToolsParallel([block1, block2]);
    expect(results[0].is_error).toBeFalsy();
    expect(results[1].is_error).toBeFalsy();

    // Final content should reflect sequential execution
    const actual = await fs.readFile(filePath, 'utf-8');
    expect(actual).toBe('step2');
  });

  it('runs Write to different files in parallel', async () => {
    const file1 = tmpPath('par-a.txt');
    const file2 = tmpPath('par-b.txt');

    const start = Date.now();
    const block1 = makeToolUseBlock('Bash', { command: `sleep 0.2 && echo done` }, 'toolu_p1');
    const block2 = makeToolUseBlock('Write', { path: file1, content: 'a' }, 'toolu_p2');
    const block3 = makeToolUseBlock('Write', { path: file2, content: 'b' }, 'toolu_p3');

    const results = await executeToolsParallel([block1, block2, block3]);
    expect(results).toHaveLength(3);
    expect(results[0].is_error).toBeFalsy();
    expect(results[1].is_error).toBeFalsy();
    expect(results[2].is_error).toBeFalsy();
  });

  it('handles errors in one tool without affecting others', async () => {
    const block1 = makeToolUseBlock('Bash', { command: 'echo ok' }, 'toolu_ok');
    const block2 = makeToolUseBlock('Read', { path: '/nonexistent/file.txt' }, 'toolu_err');

    const results = await executeToolsParallel([block1, block2]);
    expect(results).toHaveLength(2);
    expect(results[0].is_error).toBeFalsy();
    expect(results[1].is_error).toBe(true);
  });
});

// ── runToolLoop orchestrator ──────────────────────────────────

// Mock sendMessage for loop tests
vi.mock('../src/claude-client.js', () => ({
  sendMessage: vi.fn(),
  extractToolUseBlocks: vi.fn(),
  isToolUseResponse: vi.fn(),
}));

import {
  sendMessage as mockSendMessage,
  extractToolUseBlocks as mockExtractToolUseBlocks,
  isToolUseResponse as mockIsToolUseResponse,
} from '../src/claude-client.js';

/** Helper to build a fake Message from Claude. */
function fakeMessage(overrides: {
  stop_reason: string;
  content: (ToolUseBlock | TextBlock)[];
}): Message {
  return {
    id: 'msg_test_' + Math.random().toString(36).slice(2, 8),
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    stop_reason: overrides.stop_reason,
    stop_sequence: null,
    content: overrides.content,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as Message;
}

function toolUseBlock(name: string, input: Record<string, unknown>, id?: string): ToolUseBlock {
  return {
    type: 'tool_use',
    id: id ?? 'toolu_' + Math.random().toString(36).slice(2, 8),
    name,
    input,
  };
}

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

describe('runToolLoop', () => {
  beforeEach(() => {
    vi.mocked(mockSendMessage).mockReset();
    vi.mocked(mockExtractToolUseBlocks).mockReset();
    vi.mocked(mockIsToolUseResponse).mockReset();
  });

  it('returns immediately when response is not tool_use', async () => {
    const endMsg = fakeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('Hello!')],
    });
    vi.mocked(mockSendMessage).mockResolvedValueOnce(endMsg);
    vi.mocked(mockIsToolUseResponse).mockReturnValueOnce(false);

    const result = await runToolLoop([{ role: 'user', content: 'hi' }]);

    expect(result).toBe(endMsg);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('executes tool and continues conversation on tool_use response', async () => {
    const toolBlock = toolUseBlock('Bash', { command: 'echo hello' }, 'toolu_abc');
    const toolUseMsg = fakeMessage({
      stop_reason: 'tool_use',
      content: [toolBlock],
    });
    const endMsg = fakeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('Done!')],
    });

    vi.mocked(mockSendMessage)
      .mockResolvedValueOnce(toolUseMsg)
      .mockResolvedValueOnce(endMsg);
    vi.mocked(mockIsToolUseResponse)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(mockExtractToolUseBlocks)
      .mockReturnValueOnce([toolBlock]);

    const result = await runToolLoop([{ role: 'user', content: 'run echo' }]);

    expect(result).toBe(endMsg);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);

    // Second call should have the tool result in messages
    const secondCallMessages = vi.mocked(mockSendMessage).mock.calls[1][1];
    expect(secondCallMessages).toHaveLength(3); // user + assistant + user(tool_result)
    expect(secondCallMessages[1].role).toBe('assistant');
    expect(secondCallMessages[2].role).toBe('user');

    // The tool result should include the tool_use_id
    const toolResultContent = secondCallMessages[2].content;
    expect(Array.isArray(toolResultContent)).toBe(true);
    const toolResultBlock = (toolResultContent as Array<{ type: string; tool_use_id: string }>)[0];
    expect(toolResultBlock.type).toBe('tool_result');
    expect(toolResultBlock.tool_use_id).toBe('toolu_abc');
  });

  it('respects maxIterations safety limit', async () => {
    const toolBlock = toolUseBlock('Bash', { command: 'echo loop' }, 'toolu_loop');
    const toolUseMsg = fakeMessage({
      stop_reason: 'tool_use',
      content: [toolBlock],
    });

    // Always return tool_use — the loop should stop after maxIterations
    vi.mocked(mockSendMessage).mockResolvedValue(toolUseMsg);
    vi.mocked(mockIsToolUseResponse).mockReturnValue(true);
    vi.mocked(mockExtractToolUseBlocks).mockReturnValue([toolBlock]);

    const result = await runToolLoop([{ role: 'user', content: 'loop' }], {
      maxIterations: 3,
    });

    // 1 initial + 3 iterations = 4 sendMessage calls
    expect(mockSendMessage).toHaveBeenCalledTimes(4);
    expect(result).toBe(toolUseMsg);
  });

  it('executes multiple tool_use blocks in a single response', async () => {
    const block1 = toolUseBlock('Bash', { command: 'echo one' }, 'toolu_1');
    const block2 = toolUseBlock('Bash', { command: 'echo two' }, 'toolu_2');
    const multiToolMsg = fakeMessage({
      stop_reason: 'tool_use',
      content: [block1, block2],
    });
    const endMsg = fakeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('Both done.')],
    });

    vi.mocked(mockSendMessage)
      .mockResolvedValueOnce(multiToolMsg)
      .mockResolvedValueOnce(endMsg);
    vi.mocked(mockIsToolUseResponse)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(mockExtractToolUseBlocks)
      .mockReturnValueOnce([block1, block2]);

    const result = await runToolLoop([{ role: 'user', content: 'multi' }]);

    expect(result).toBe(endMsg);

    // Second call should have both tool results
    const secondCallMessages = vi.mocked(mockSendMessage).mock.calls[1][1];
    const toolResultContent = secondCallMessages[2].content as Array<{ type: string; tool_use_id: string }>;
    expect(toolResultContent).toHaveLength(2);
    expect(toolResultContent[0].tool_use_id).toBe('toolu_1');
    expect(toolResultContent[1].tool_use_id).toBe('toolu_2');
  });

  it('does not mutate the original messages array', async () => {
    const endMsg = fakeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('hi')],
    });
    vi.mocked(mockSendMessage).mockResolvedValueOnce(endMsg);
    vi.mocked(mockIsToolUseResponse).mockReturnValueOnce(false);

    const original = [{ role: 'user' as const, content: 'test' }];
    await runToolLoop(original);

    expect(original).toHaveLength(1);
  });

  it('terminates when retry budget is exhausted', async () => {
    // Pre-fill a budget so it's already at limit
    const budget = new RetryBudget(2);
    budget.recordBlock('VK-04');
    budget.recordBlock('VK-04');

    // Budget should terminate immediately before first tool execution
    const toolBlock = toolUseBlock('Bash', { command: 'echo hi' }, 'toolu_budget');
    const toolUseMsg = fakeMessage({
      stop_reason: 'tool_use',
      content: [toolBlock],
    });

    vi.mocked(mockSendMessage).mockResolvedValueOnce(toolUseMsg);
    vi.mocked(mockIsToolUseResponse).mockReturnValueOnce(true);
    vi.mocked(mockExtractToolUseBlocks).mockReturnValueOnce([toolBlock]);

    const result = await runToolLoop(
      [{ role: 'user', content: 'do something' }],
      { retryBudget: budget },
    );

    // Should return the tool_use message (loop broke before executing)
    expect(result).toBe(toolUseMsg);
    // sendMessage only called once (initial), no tool execution round
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('passes retryBudget through to executeTool via ToolContext', async () => {
    const budget = new RetryBudget(10);

    const toolBlock = toolUseBlock('Bash', { command: 'echo hello' }, 'toolu_ctx');
    const toolUseMsg = fakeMessage({
      stop_reason: 'tool_use',
      content: [toolBlock],
    });
    const endMsg = fakeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('Done')],
    });

    vi.mocked(mockSendMessage)
      .mockResolvedValueOnce(toolUseMsg)
      .mockResolvedValueOnce(endMsg);
    vi.mocked(mockIsToolUseResponse)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(mockExtractToolUseBlocks)
      .mockReturnValueOnce([toolBlock]);

    await runToolLoop(
      [{ role: 'user', content: 'run bash' }],
      { retryBudget: budget },
    );

    // Successful execution should have cleared the budget
    expect(budget.shouldTerminate().terminate).toBe(false);
  });
});

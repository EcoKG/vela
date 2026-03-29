/**
 * StdinBuffer buffers input and emits complete sequences.
 *
 * This is necessary because stdin data events can arrive in partial chunks,
 * especially for escape sequences like mouse events. Without buffering,
 * partial sequences can be misinterpreted as regular keypresses.
 *
 * For example, the mouse SGR sequence `\x1b[<35;20;5m` might arrive as:
 * - Event 1: `\x1b`
 * - Event 2: `[<35`
 * - Event 3: `;20;5m`
 *
 * The buffer accumulates these until a complete sequence is detected.
 * Call the `process()` method to feed input data.
 *
 * Based on code from OpenTUI (https://github.com/anomalyco/opentui)
 * MIT License - Copyright (c) 2025 opentui
 */

import { EventEmitter } from 'events';

const ESC = '\x1b';
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

/** Sequence completion status */
type SequenceStatus = 'complete' | 'incomplete' | 'not-escape';

/** Options for StdinBuffer */
export interface StdinBufferOptions {
  /** Timeout in ms before flushing incomplete sequences (default: 10) */
  timeout?: number;
}

/** Result of extracting complete sequences from a buffer */
interface ExtractResult {
  sequences: string[];
  remainder: string;
}

/**
 * Check if a string is a complete escape sequence or needs more data
 */
function isCompleteSequence(data: string): SequenceStatus {
  if (!data.startsWith(ESC)) {
    return 'not-escape';
  }

  if (data.length === 1) {
    return 'incomplete';
  }

  const afterEsc = data.slice(1);

  // CSI sequences: ESC [
  if (afterEsc.startsWith('[')) {
    // Check for old-style mouse sequence: ESC[M + 3 bytes
    if (afterEsc.startsWith('[M')) {
      return data.length >= 6 ? 'complete' : 'incomplete';
    }
    return isCompleteCsiSequence(data);
  }

  // OSC sequences: ESC ]
  if (afterEsc.startsWith(']')) {
    return isCompleteOscSequence(data);
  }

  // DCS sequences: ESC P ... ESC \
  if (afterEsc.startsWith('P')) {
    return isCompleteDcsSequence(data);
  }

  // APC sequences: ESC _ ... ESC \
  if (afterEsc.startsWith('_')) {
    return isCompleteApcSequence(data);
  }

  // SS3 sequences: ESC O
  if (afterEsc.startsWith('O')) {
    return afterEsc.length >= 2 ? 'complete' : 'incomplete';
  }

  // Meta key sequences: ESC followed by a single character
  if (afterEsc.length === 1) {
    return 'complete';
  }

  return 'complete';
}

/**
 * Check if CSI sequence is complete
 * CSI sequences: ESC [ ... followed by a final byte (0x40-0x7E)
 */
function isCompleteCsiSequence(data: string): SequenceStatus {
  if (!data.startsWith(`${ESC}[`)) {
    return 'complete';
  }

  if (data.length < 3) {
    return 'incomplete';
  }

  const payload = data.slice(2);
  const lastChar = payload[payload.length - 1]!;
  const lastCharCode = lastChar.charCodeAt(0);

  if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
    // Special handling for SGR mouse sequences
    if (payload.startsWith('<')) {
      const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload);
      if (mouseMatch) {
        return 'complete';
      }
      if (lastChar === 'M' || lastChar === 'm') {
        const parts = payload.slice(1, -1).split(';');
        if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
          return 'complete';
        }
      }
      return 'incomplete';
    }
    return 'complete';
  }

  return 'incomplete';
}

/**
 * Check if OSC sequence is complete
 * OSC sequences: ESC ] ... ST (where ST is ESC \ or BEL)
 */
function isCompleteOscSequence(data: string): SequenceStatus {
  if (!data.startsWith(`${ESC}]`)) {
    return 'complete';
  }
  if (data.endsWith(`${ESC}\\`) || data.endsWith('\x07')) {
    return 'complete';
  }
  return 'incomplete';
}

/**
 * Check if DCS (Device Control String) sequence is complete
 * DCS sequences: ESC P ... ST (where ST is ESC \)
 */
function isCompleteDcsSequence(data: string): SequenceStatus {
  if (!data.startsWith(`${ESC}P`)) {
    return 'complete';
  }
  if (data.endsWith(`${ESC}\\`)) {
    return 'complete';
  }
  return 'incomplete';
}

/**
 * Check if APC (Application Program Command) sequence is complete
 * APC sequences: ESC _ ... ST (where ST is ESC \)
 */
function isCompleteApcSequence(data: string): SequenceStatus {
  if (!data.startsWith(`${ESC}_`)) {
    return 'complete';
  }
  if (data.endsWith(`${ESC}\\`)) {
    return 'complete';
  }
  return 'incomplete';
}

/**
 * Split accumulated buffer into complete sequences
 */
function extractCompleteSequences(buffer: string): ExtractResult {
  const sequences: string[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const remaining = buffer.slice(pos);

    if (remaining.startsWith(ESC)) {
      let seqEnd = 1;
      while (seqEnd <= remaining.length) {
        const candidate = remaining.slice(0, seqEnd);
        const status = isCompleteSequence(candidate);

        if (status === 'complete') {
          sequences.push(candidate);
          pos += seqEnd;
          break;
        } else if (status === 'incomplete') {
          seqEnd++;
        } else {
          sequences.push(candidate);
          pos += seqEnd;
          break;
        }
      }

      if (seqEnd > remaining.length) {
        return { sequences, remainder: remaining };
      }
    } else {
      sequences.push(remaining[0]!);
      pos++;
    }
  }

  return { sequences, remainder: '' };
}

/**
 * Buffers stdin input and emits complete sequences via the 'data' event.
 * Handles partial escape sequences that arrive across multiple chunks.
 *
 * Events:
 * - 'data': Emitted with each complete key/escape sequence string
 * - 'paste': Emitted with the pasted content string (bracketed paste)
 */
export class StdinBuffer extends EventEmitter {
  private buffer: string = '';
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private pasteMode: boolean = false;
  private pasteBuffer: string = '';
  private timeoutMs: number;

  constructor(options: StdinBufferOptions = {}) {
    super();
    this.timeoutMs = options.timeout ?? 10;
  }

  process(data: string | Buffer): void {
    // Clear any pending timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // Handle high-byte conversion (for compatibility with parseKeypress)
    let str: string;
    if (Buffer.isBuffer(data)) {
      if (data.length === 1 && data[0]! > 127) {
        const byte = data[0]! - 128;
        str = `\x1b${String.fromCharCode(byte)}`;
      } else {
        str = data.toString();
      }
    } else {
      str = data;
    }

    if (str.length === 0 && this.buffer.length === 0) {
      this.emit('data', '');
      return;
    }

    this.buffer += str;

    if (this.pasteMode) {
      this.pasteBuffer += this.buffer;
      this.buffer = '';

      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
        this.pasteMode = false;
        this.pasteBuffer = '';
        this.emit('paste', pastedContent);
        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }

    const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      if (startIndex > 0) {
        const beforePaste = this.buffer.slice(0, startIndex);
        const result = extractCompleteSequences(beforePaste);
        for (const sequence of result.sequences) {
          this.emit('data', sequence);
        }
      }

      this.buffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
      this.pasteMode = true;
      this.pasteBuffer = this.buffer;
      this.buffer = '';

      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
        this.pasteMode = false;
        this.pasteBuffer = '';
        this.emit('paste', pastedContent);
        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }

    const result = extractCompleteSequences(this.buffer);
    this.buffer = result.remainder;

    for (const sequence of result.sequences) {
      this.emit('data', sequence);
    }

    if (this.buffer.length > 0) {
      this.timeout = setTimeout(() => {
        const flushed = this.flush();
        for (const sequence of flushed) {
          this.emit('data', sequence);
        }
      }, this.timeoutMs);
    }
  }

  flush(): string[] {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.buffer.length === 0) {
      return [];
    }

    const sequences = [this.buffer];
    this.buffer = '';
    return sequences;
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.buffer = '';
    this.pasteMode = false;
    this.pasteBuffer = '';
  }

  getBuffer(): string {
    return this.buffer;
  }

  destroy(): void {
    this.clear();
  }
}

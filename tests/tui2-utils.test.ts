import { describe, it, expect } from 'vitest';
import {
  visibleWidth,
  wrapTextWithAnsi,
  truncateToWidth,
  sliceByColumn,
  sliceWithWidth,
  extractSegments,
  applyBackgroundToLine,
  getSegmenter,
  isWhitespaceChar,
  isPunctuationChar,
} from '../src/tui2/utils.js';
import { KillRing } from '../src/tui2/kill-ring.js';
import { UndoStack } from '../src/tui2/undo-stack.js';

// ---------------------------------------------------------------------------
// visibleWidth
// ---------------------------------------------------------------------------

describe('visibleWidth', () => {
  it('measures ASCII strings', () => {
    expect(visibleWidth('hello')).toBe(5);
    expect(visibleWidth('')).toBe(0);
    expect(visibleWidth(' ')).toBe(1);
  });

  it('measures CJK wide characters (2 columns each)', () => {
    expect(visibleWidth('你好')).toBe(4);
    expect(visibleWidth('日本語')).toBe(6);
    expect(visibleWidth('A你B')).toBe(4); // 1 + 2 + 1
  });

  it('measures emoji', () => {
    // Most emoji are 2 columns wide
    expect(visibleWidth('👍')).toBe(2);
  });

  it('ignores ANSI escape codes', () => {
    expect(visibleWidth('\x1b[31mred\x1b[0m')).toBe(3);
    expect(visibleWidth('\x1b[1;32mbold green\x1b[0m')).toBe(10);
    expect(visibleWidth('\x1b[31m\x1b[0m')).toBe(0);
  });

  it('handles mixed ANSI and CJK', () => {
    expect(visibleWidth('\x1b[31m你好\x1b[0m')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// wrapTextWithAnsi
// ---------------------------------------------------------------------------

describe('wrapTextWithAnsi', () => {
  it('wraps simple text', () => {
    expect(wrapTextWithAnsi('hello world', 6)).toEqual(['hello', 'world']);
  });

  it('preserves ANSI codes across wraps', () => {
    const lines = wrapTextWithAnsi('\x1b[31mhello world\x1b[0m', 6);
    expect(lines.length).toBe(2);
    // The ANSI codes should be preserved in the output
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(6);
  });

  it('handles CJK in wrapping', () => {
    // '你好世界' = 8 cols; wrapping at 5 should break between chars
    const lines = wrapTextWithAnsi('你好世界', 5);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(5);
    }
  });

  it('handles empty string', () => {
    expect(wrapTextWithAnsi('', 80)).toEqual(['']);
  });

  it('preserves existing newlines', () => {
    const lines = wrapTextWithAnsi('a\nb', 80);
    expect(lines).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------

describe('truncateToWidth', () => {
  it('returns text unchanged when within maxWidth', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
  });

  it('truncates and adds ellipsis', () => {
    const result = truncateToWidth('hello world', 8);
    expect(result).toBe('hello...');
    expect(visibleWidth(result)).toBeLessThanOrEqual(8);
  });

  it('handles CJK at boundary correctly', () => {
    // '你好' = 4 cols; truncating to 3 should yield '你' (2) not '你好' (4)
    // With default ellipsis '...' (3 cols), target = 3-3=0 → tricky
    // Let's use no ellipsis for a cleaner test
    const result = truncateToWidth('你好world', 3, '');
    expect(visibleWidth(result)).toBeLessThanOrEqual(3);
  });

  it('handles Unicode ellipsis', () => {
    const result = truncateToWidth('hello world', 7, '…');
    expect(visibleWidth(result)).toBeLessThanOrEqual(7);
  });

  it('pads to maxWidth when pad=true', () => {
    const result = truncateToWidth('hi', 10, '...', true);
    expect(visibleWidth(result)).toBe(10);
    expect(result).toBe('hi        ');
  });

  it('pads truncated text to maxWidth when pad=true', () => {
    const result = truncateToWidth('hello world', 8, '...', true);
    expect(visibleWidth(result)).toBe(8);
  });

  it('handles maxWidth=0', () => {
    expect(truncateToWidth('hello', 0)).toBe('');
  });

  it('truncates ANSI-coded text correctly', () => {
    const result = truncateToWidth('\x1b[31mhello world\x1b[0m', 8);
    expect(visibleWidth(result)).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// sliceByColumn / sliceWithWidth
// ---------------------------------------------------------------------------

describe('sliceByColumn', () => {
  it('extracts a range of columns from ASCII', () => {
    expect(sliceByColumn('hello world', 0, 5)).toBe('hello');
    expect(sliceByColumn('hello world', 6, 5)).toBe('world');
  });

  it('handles CJK characters', () => {
    // '你好世界' = cols 0-1, 2-3, 4-5, 6-7
    expect(sliceByColumn('你好世界', 0, 4)).toBe('你好');
    expect(sliceByColumn('你好世界', 2, 4)).toBe('好世');
  });

  it('handles zero length', () => {
    expect(sliceByColumn('hello', 0, 0)).toBe('');
  });

  it('preserves ANSI codes in range', () => {
    const result = sliceByColumn('\x1b[31mhello\x1b[0m world', 0, 5);
    // Should contain the visible 'hello' with its ANSI codes
    expect(visibleWidth(result)).toBe(5);
  });
});

describe('sliceWithWidth', () => {
  it('returns text and actual width', () => {
    const result = sliceWithWidth('hello', 0, 3);
    expect(result.text).toBe('hel');
    expect(result.width).toBe(3);
  });

  it('handles CJK width boundary', () => {
    // '你好' = 4 cols; slicing 3 cols should get '你' (2 cols)
    const result = sliceWithWidth('你好', 0, 3);
    expect(result.text).toBe('你');
    expect(result.width).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractSegments
// ---------------------------------------------------------------------------

describe('extractSegments', () => {
  it('extracts before and after segments', () => {
    const result = extractSegments('hello world', 5, 6, 5);
    expect(result.before.text).toBe('hello');
    expect(result.after.text).toBe('world');
  });
});

// ---------------------------------------------------------------------------
// applyBackgroundToLine
// ---------------------------------------------------------------------------

describe('applyBackgroundToLine', () => {
  it('pads and applies background', () => {
    const bgFn = (s: string) => `[BG]${s}[/BG]`;
    const result = applyBackgroundToLine('hi', 10, bgFn);
    expect(result).toBe('[BG]hi        [/BG]');
  });

  it('handles line already at full width', () => {
    const bgFn = (s: string) => `[BG]${s}[/BG]`;
    const result = applyBackgroundToLine('hello', 5, bgFn);
    expect(result).toBe('[BG]hello[/BG]');
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('getSegmenter', () => {
  it('returns a shared Intl.Segmenter instance', () => {
    const s1 = getSegmenter();
    const s2 = getSegmenter();
    expect(s1).toBe(s2);
    expect(s1).toBeInstanceOf(Intl.Segmenter);
  });
});

describe('isWhitespaceChar', () => {
  it('detects whitespace', () => {
    expect(isWhitespaceChar(' ')).toBe(true);
    expect(isWhitespaceChar('\t')).toBe(true);
    expect(isWhitespaceChar('\n')).toBe(true);
    expect(isWhitespaceChar('a')).toBe(false);
  });
});

describe('isPunctuationChar', () => {
  it('detects punctuation', () => {
    expect(isPunctuationChar('.')).toBe(true);
    expect(isPunctuationChar('!')).toBe(true);
    expect(isPunctuationChar('(')).toBe(true);
    expect(isPunctuationChar('a')).toBe(false);
    expect(isPunctuationChar('1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KillRing
// ---------------------------------------------------------------------------

describe('KillRing', () => {
  it('pushes and peeks', () => {
    const kr = new KillRing();
    kr.push('hello', {});
    expect(kr.peek()).toBe('hello');
    expect(kr.length).toBe(1);
  });

  it('accumulates forward', () => {
    const kr = new KillRing();
    kr.push('hello', {});
    kr.push(' world', { accumulate: true });
    expect(kr.peek()).toBe('hello world');
    expect(kr.length).toBe(1);
  });

  it('accumulates with prepend', () => {
    const kr = new KillRing();
    kr.push('world', {});
    kr.push('hello ', { accumulate: true, prepend: true });
    expect(kr.peek()).toBe('hello world');
  });

  it('rotates entries', () => {
    const kr = new KillRing();
    kr.push('first', {});
    kr.push('second', {});
    kr.push('third', {});
    expect(kr.peek()).toBe('third');
    kr.rotate();
    expect(kr.peek()).toBe('second');
  });

  it('ignores empty pushes', () => {
    const kr = new KillRing();
    kr.push('', {});
    expect(kr.length).toBe(0);
  });

  it('returns undefined for empty peek', () => {
    const kr = new KillRing();
    expect(kr.peek()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UndoStack
// ---------------------------------------------------------------------------

describe('UndoStack', () => {
  it('pushes and pops deep clones', () => {
    const stack = new UndoStack<{ value: number }>();
    const state = { value: 1 };
    stack.push(state);
    state.value = 2; // Mutate original
    const popped = stack.pop();
    expect(popped).toEqual({ value: 1 }); // Clone preserved original
  });

  it('clears all entries', () => {
    const stack = new UndoStack<number>();
    stack.push(1);
    stack.push(2);
    expect(stack.length).toBe(2);
    stack.clear();
    expect(stack.length).toBe(0);
  });

  it('returns undefined on empty pop', () => {
    const stack = new UndoStack<string>();
    expect(stack.pop()).toBeUndefined();
  });
});

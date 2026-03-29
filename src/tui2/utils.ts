/**
 * Text measurement utilities for terminal TUI rendering.
 *
 * Pure JS replacements for the @gsd/native text module.
 * Uses string-width, wrap-ansi, strip-ansi for ANSI-aware text measurement.
 */

import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import stripAnsi from 'strip-ansi';

// ---------------------------------------------------------------------------
// Grapheme segmenter (shared instance)
// ---------------------------------------------------------------------------

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Get the shared grapheme segmenter instance. */
export function getSegmenter(): Intl.Segmenter {
  return segmenter;
}

// ---------------------------------------------------------------------------
// Character classification helpers
// ---------------------------------------------------------------------------

const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;

/** Check if a character is whitespace. */
export function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

/** Check if a character is punctuation. */
export function isPunctuationChar(char: string): boolean {
  return PUNCTUATION_REGEX.test(char);
}

// ---------------------------------------------------------------------------
// Core text measurement
// ---------------------------------------------------------------------------

/**
 * Calculate the visible width of a string in terminal columns.
 * Handles ANSI codes, CJK wide characters, and emoji.
 */
export function visibleWidth(str: string): number {
  return stringWidth(str);
}

/**
 * Wrap text with ANSI codes preserved.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
  return wrapAnsi(text, width, { hard: true }).split('\n');
}

// ---------------------------------------------------------------------------
// Truncation and slicing
// ---------------------------------------------------------------------------

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 *
 * When a wide character (e.g. CJK) would straddle the boundary, it is excluded
 * entirely rather than included partially.
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "...")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis: string = '...',
  pad: boolean = false,
): string {
  if (maxWidth <= 0) return pad ? '' : '';

  const textWidth = visibleWidth(text);
  if (textWidth <= maxWidth) {
    return pad ? text + ' '.repeat(maxWidth - textWidth) : text;
  }

  const ellipsisWidth = visibleWidth(ellipsis);
  const targetWidth = maxWidth - ellipsisWidth;

  if (targetWidth <= 0) {
    // Ellipsis itself exceeds maxWidth — just truncate the ellipsis
    const truncatedEllipsis = sliceByColumn(ellipsis, 0, maxWidth);
    return pad
      ? truncatedEllipsis + ' '.repeat(maxWidth - visibleWidth(truncatedEllipsis))
      : truncatedEllipsis;
  }

  const { text: truncated, width: truncatedWidth } = sliceWithWidth(text, 0, targetWidth);
  const result = truncated + ellipsis;
  const resultWidth = truncatedWidth + ellipsisWidth;

  return pad ? result + ' '.repeat(Math.max(0, maxWidth - resultWidth)) : result;
}

// ---------------------------------------------------------------------------
// ANSI-aware regex for splitting text into visible chars and escape sequences
// ---------------------------------------------------------------------------

// Matches an ANSI escape sequence (CSI sequences, OSC sequences, and simple escapes)
const ANSI_REGEX = /\x1b(?:\[[0-9;]*[A-Za-z]|\].*?(?:\x07|\x1b\\)|\[[0-9;]*m)/g;

/**
 * Split a string into segments of ANSI escape sequences and visible text graphemes,
 * preserving ordering.
 */
function splitAnsiAndGraphemes(line: string): Array<{ type: 'ansi' | 'grapheme'; value: string }> {
  const result: Array<{ type: 'ansi' | 'grapheme'; value: string }> = [];
  const stripped = stripAnsi(line);

  // Walk the original string, separating ANSI sequences from visible text
  let pos = 0;
  let strippedIdx = 0;
  const graphemes = [...segmenter.segment(stripped)].map((s) => s.segment);
  let graphemeIdx = 0;

  while (pos < line.length) {
    // Check for ANSI escape at current position
    ANSI_REGEX.lastIndex = pos;
    const match = ANSI_REGEX.exec(line);
    if (match && match.index === pos) {
      result.push({ type: 'ansi', value: match[0] });
      pos += match[0].length;
      continue;
    }

    // Consume next grapheme from the stripped string
    if (graphemeIdx < graphemes.length) {
      const g = graphemes[graphemeIdx]!;
      // Find this grapheme in the original line starting at pos
      // Skip any ANSI sequences that appear before this grapheme
      let searchPos = pos;
      while (searchPos < line.length) {
        ANSI_REGEX.lastIndex = searchPos;
        const ansiMatch = ANSI_REGEX.exec(line);
        if (ansiMatch && ansiMatch.index === searchPos) {
          result.push({ type: 'ansi', value: ansiMatch[0] });
          searchPos += ansiMatch[0].length;
          continue;
        }
        break;
      }

      // Now we should be at the grapheme
      if (searchPos < line.length && line.startsWith(g, searchPos)) {
        result.push({ type: 'grapheme', value: g });
        pos = searchPos + g.length;
        strippedIdx += g.length;
        graphemeIdx++;
      } else {
        // Fallback: advance one char
        result.push({ type: 'grapheme', value: line[pos]! });
        pos++;
        strippedIdx++;
        graphemeIdx++;
      }
    } else {
      // Remaining chars are ANSI or trailing content
      result.push({ type: 'ansi', value: line.slice(pos) });
      break;
    }
  }

  return result;
}

/**
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 *
 * @param line - Text line (may contain ANSI codes)
 * @param startCol - Starting visible column (0-based)
 * @param length - Number of visible columns to extract
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export function sliceByColumn(
  line: string,
  startCol: number,
  length: number,
  strict: boolean = false,
): string {
  return sliceWithWidth(line, startCol, length, strict).text;
}

/** Result of sliceWithWidth — the extracted text and its actual visible width. */
export interface SliceResult {
  text: string;
  width: number;
}

/**
 * Like sliceByColumn but also returns the actual visible width of the result.
 */
export function sliceWithWidth(
  line: string,
  startCol: number,
  length: number,
  strict: boolean = false,
): SliceResult {
  if (length <= 0) return { text: '', width: 0 };

  const segments = splitAnsiAndGraphemes(line);
  let currentCol = 0;
  let result = '';
  let resultWidth = 0;
  let inRange = false;

  for (const seg of segments) {
    if (seg.type === 'ansi') {
      // Always include ANSI sequences if we're past startCol or about to be
      if (inRange) {
        result += seg.value;
      }
      continue;
    }

    const charWidth = stringWidth(seg.value);

    // Before start range
    if (currentCol + charWidth <= startCol) {
      currentCol += charWidth;
      continue;
    }

    // Straddles start boundary
    if (currentCol < startCol) {
      if (strict) {
        // Skip this wide char
        currentCol += charWidth;
        inRange = true;
        continue;
      }
      // Include it (partial overlap at start)
      inRange = true;
      // Fall through to inclusion logic
    }

    if (!inRange) inRange = true;

    // Would exceed length
    if (resultWidth + charWidth > length) {
      if (strict) break;
      // For non-strict, also stop (don't include partial wide chars)
      break;
    }

    result += seg.value;
    resultWidth += charWidth;
    currentCol += charWidth;

    if (resultWidth >= length) break;
  }

  return { text: result, width: resultWidth };
}

/**
 * Extract "before" and "after" segments from a line in a single pass.
 *
 * @param line - Source line
 * @param beforeEnd - End column for the "before" segment (exclusive)
 * @param afterStart - Start column for the "after" segment
 * @param afterLen - Length of the "after" segment
 * @param strictAfter - Use strict mode for the "after" segment
 */
export function extractSegments(
  line: string,
  beforeEnd: number,
  afterStart: number,
  afterLen: number,
  strictAfter: boolean = false,
): { before: SliceResult; after: SliceResult } {
  return {
    before: sliceWithWidth(line, 0, beforeEnd),
    after: sliceWithWidth(line, afterStart, afterLen, strictAfter),
  };
}

// ---------------------------------------------------------------------------
// Background line helper
// ---------------------------------------------------------------------------

/**
 * Apply background color to a line, padding to full width.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgFn - Background color function (e.g. chalk.bgBlue)
 */
export function applyBackgroundToLine(
  line: string,
  width: number,
  bgFn: (s: string) => string,
): string {
  const visibleLen = visibleWidth(line);
  const paddingNeeded = Math.max(0, width - visibleLen);
  const padding = ' '.repeat(paddingNeeded);
  const withPadding = line + padding;
  return bgFn(withPadding);
}

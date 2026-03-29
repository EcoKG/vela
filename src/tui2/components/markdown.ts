/**
 * Markdown renderer component for tui2.
 *
 * Uses marked.lexer() to tokenize Markdown, then renders each block token
 * into terminal-ready string[] lines with ANSI SGR styling.
 *
 * Follows the render(width) → string[] contract (K029).
 * Uses raw ANSI SGR codes, not ink's color system (K028).
 */

import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import type { ThemePalette } from '../../tui/theme.js';
import { visibleWidth, wrapTextWithAnsi, truncateToWidth } from '../utils.js';

// ── ANSI SGR constants ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const STRIKETHROUGH = '\x1b[9m';
const INVERSE = '\x1b[7m';

/** Map semantic color names (from ThemePalette) to ANSI SGR foreground codes. */
const COLOR_MAP: Record<string, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const BG_COLOR_MAP: Record<string, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  gray: '\x1b[100m',
};

function sgr(color: string | undefined): string {
  if (!color) return '';
  return COLOR_MAP[color] ?? '';
}

function sgrBg(color: string | undefined): string {
  if (!color) return '';
  return BG_COLOR_MAP[color] ?? '';
}

// ── Interfaces ──────────────────────────────────────────────────────────────

/** Style functions used by the Markdown renderer. All return ANSI-wrapped strings. */
export interface MarkdownTheme {
  /** Heading text — receives depth (1-6) */
  heading: (text: string, depth: number) => string;
  /** Bold / strong */
  bold: (text: string) => string;
  /** Italic / emphasis */
  italic: (text: string) => string;
  /** Inline code span */
  codeSpan: (text: string) => string;
  /** Strikethrough */
  strikethrough: (text: string) => string;
  /** Link — rendered as text + href */
  link: (text: string, href: string) => string;
  /** Blockquote border character + color */
  blockquoteBorder: string;
  /** Code block border color */
  codeBorderColor: string;
  /** Code block text color */
  codeTextColor: string;
  /** Table border color */
  tableBorderColor: string;
  /** Table header text style */
  tableHeader: (text: string) => string;
  /** Horizontal rule color */
  hrColor: string;
  /** Dim text (e.g. language label) */
  dim: (text: string) => string;
  /** Optional syntax highlighter — omitted for S02 */
  highlightCode?: (code: string, lang: string) => string;
}

/** Default text style settings derived from the theme. */
export interface DefaultTextStyle {
  color: string | undefined;
  reset: string;
}

// ── Theme adapter ───────────────────────────────────────────────────────────

/**
 * Create a MarkdownTheme from a ThemePalette.
 * Maps semantic color names → ANSI SGR styling functions.
 */
export function createMarkdownTheme(palette: ThemePalette): MarkdownTheme {
  const accentCode = sgr(palette.accent);
  const highlightCode = sgr(palette.highlight);
  const dimCode = sgr(palette.dim);
  const borderCode = sgr(palette.border);
  const textCode = sgr(palette.text);

  return {
    heading: (text: string, depth: number) => {
      // h1-h2: bold + accent, h3+: bold + highlight
      const color = depth <= 2 ? accentCode : highlightCode;
      return `${color}${BOLD}${text}${RESET}`;
    },
    bold: (text: string) => `${BOLD}${text}${RESET}`,
    italic: (text: string) => `${ITALIC}${text}${RESET}`,
    codeSpan: (text: string) => `${DIM}${INVERSE} ${text} ${RESET}`,
    strikethrough: (text: string) => `${STRIKETHROUGH}${text}${RESET}`,
    link: (text: string, href: string) => {
      return `${UNDERLINE}${accentCode}${text}${RESET} ${dimCode}(${href})${RESET}`;
    },
    blockquoteBorder: `${borderCode}│${RESET}`,
    codeBorderColor: palette.border,
    codeTextColor: palette.dim,
    tableBorderColor: palette.border,
    tableHeader: (text: string) => `${BOLD}${text}${RESET}`,
    hrColor: palette.border,
    dim: (text: string) => `${dimCode}${text}${RESET}`,
  };
}

// ── Box-drawing characters ──────────────────────────────────────────────────

const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  // Table-specific
  tTop: '┬',
  tBottom: '┴',
  tLeft: '├',
  tRight: '┤',
  cross: '┼',
  thickH: '═',
} as const;

// ── Markdown component ──────────────────────────────────────────────────────

/**
 * Markdown renderer component.
 * Follows the tui2 render(width) → string[] contract (K029).
 */
export class Markdown {
  private text: string;
  private theme: MarkdownTheme;

  // Render cache
  private cachedText?: string;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(text: string = '', theme?: MarkdownTheme) {
    this.text = text;
    this.theme = theme ?? createDefaultTheme();
  }

  setText(text: string): void {
    if (this.text !== text) {
      this.text = text;
      this.invalidate();
    }
  }

  setTheme(theme: MarkdownTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (
      this.cachedLines &&
      this.cachedText === this.text &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }

    const lines = this.renderMarkdown(this.text, width);

    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  // ── Core rendering ──────────────────────────────────────────────────────

  private renderMarkdown(text: string, width: number): string[] {
    if (!text || text.trim() === '') return [];

    const tokens = marked.lexer(text);
    return this.renderTokens(tokens, width);
  }

  private renderTokens(tokens: Token[], width: number): string[] {
    const lines: string[] = [];
    let lastWasBlock = false;

    for (const token of tokens) {
      if (token.type === 'space') continue;

      const blockLines = this.renderBlockToken(token, width);
      if (blockLines.length === 0) continue;

      // Add blank line between block-level elements
      if (lastWasBlock && lines.length > 0) {
        lines.push('');
      }

      lines.push(...blockLines);
      lastWasBlock = true;
    }

    return lines;
  }

  private renderBlockToken(token: Token, width: number): string[] {
    switch (token.type) {
      case 'heading':
        return this.renderHeading(token as Tokens.Heading, width);
      case 'paragraph':
        return this.renderParagraph(token as Tokens.Paragraph, width);
      case 'code':
        return this.renderCode(token as Tokens.Code, width);
      case 'blockquote':
        return this.renderBlockquote(token as Tokens.Blockquote, width);
      case 'list':
        return this.renderList(token as Tokens.List, width, 0);
      case 'table':
        return this.renderTable(token as Tokens.Table, width);
      case 'hr':
        return this.renderHr(width);
      case 'html':
        return this.renderHtml(token as Tokens.HTML, width);
      default:
        // Unknown block token — render as plain text if possible
        if ('text' in token && typeof token.text === 'string') {
          return wrapTextWithAnsi(token.text, width);
        }
        return [];
    }
  }

  // ── Block renderers ─────────────────────────────────────────────────────

  private renderHeading(token: Tokens.Heading, width: number): string[] {
    const prefix = '#'.repeat(token.depth) + ' ';
    const inlineText = this.renderInlineTokens(token.tokens);
    const styledText = this.theme.heading(prefix + inlineText, token.depth);
    return wrapTextWithAnsi(styledText, width);
  }

  private renderParagraph(token: Tokens.Paragraph, width: number): string[] {
    const text = this.renderInlineTokens(token.tokens);
    return wrapTextWithAnsi(text, width);
  }

  private renderCode(token: Tokens.Code, width: number): string[] {
    const borderColor = sgr(this.theme.codeBorderColor);
    const textColor = sgr(this.theme.codeTextColor);
    const lines: string[] = [];

    const innerWidth = Math.max(1, width - 4); // 2 for borders + 1 padding each side

    // Top border with optional language label
    let topBorder = `${borderColor}${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}${RESET}`;
    if (token.lang) {
      const label = ` ${token.lang} `;
      const labelLen = visibleWidth(label);
      const rightLen = Math.max(1, width - 2 - labelLen);
      topBorder = `${borderColor}${BOX.topLeft}${BOX.horizontal}${RESET}${this.theme.dim(label)}${borderColor}${BOX.horizontal.repeat(rightLen)}${BOX.topRight}${RESET}`;
    }
    lines.push(topBorder);

    // Code content
    const codeText = token.text;
    const codeLines = codeText.split('\n');
    for (const codeLine of codeLines) {
      const wrapped = wrapTextWithAnsi(codeLine, innerWidth);
      for (const wl of wrapped) {
        const lineWidth = visibleWidth(wl);
        const pad = Math.max(0, innerWidth - lineWidth);
        lines.push(
          `${borderColor}${BOX.vertical}${RESET} ${textColor}${wl}${RESET}${' '.repeat(pad)} ${borderColor}${BOX.vertical}${RESET}`,
        );
      }
    }

    // Bottom border
    lines.push(
      `${borderColor}${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}${RESET}`,
    );

    return lines;
  }

  private renderBlockquote(token: Tokens.Blockquote, width: number): string[] {
    const border = this.theme.blockquoteBorder;
    const borderWidth = 2; // "│ "
    const innerWidth = Math.max(1, width - borderWidth);

    // Render inner content (blockquote can contain paragraphs, lists, etc.)
    const innerLines = this.renderTokens(token.tokens, innerWidth);

    return innerLines.map((line) => `${border} ${line}`);
  }

  private renderList(
    token: Tokens.List,
    width: number,
    depth: number,
  ): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);
    const indentWidth = visibleWidth(indent);

    for (let i = 0; i < token.items.length; i++) {
      const item = token.items[i]!;
      const bullet = token.ordered
        ? `${(typeof token.start === 'number' ? token.start : 1) + i}. `
        : '• ';
      const bulletWidth = visibleWidth(bullet);
      const contentWidth = Math.max(1, width - indentWidth - bulletWidth);

      // Render item content
      const itemLines = this.renderListItemContent(item, contentWidth, depth);

      if (itemLines.length > 0) {
        // First line gets the bullet
        lines.push(`${indent}${bullet}${itemLines[0]}`);
        // Continuation lines get indented to align with content after bullet
        const contIndent = ' '.repeat(bulletWidth);
        for (let j = 1; j < itemLines.length; j++) {
          lines.push(`${indent}${contIndent}${itemLines[j]}`);
        }
      }
    }

    return lines;
  }

  private renderListItemContent(
    item: Tokens.ListItem,
    width: number,
    depth: number,
  ): string[] {
    const lines: string[] = [];

    // Task list checkbox
    const checkbox = item.task
      ? item.checked
        ? '☑ '
        : '☐ '
      : '';

    for (const child of item.tokens) {
      if (child.type === 'text' && 'tokens' in child && Array.isArray(child.tokens)) {
        const text = checkbox + this.renderInlineTokens(child.tokens as Token[]);
        lines.push(...wrapTextWithAnsi(text, width));
      } else if (child.type === 'list') {
        lines.push(...this.renderList(child as Tokens.List, width, depth + 1));
      } else if (child.type === 'paragraph') {
        const text = checkbox + this.renderInlineTokens((child as Tokens.Paragraph).tokens);
        lines.push(...wrapTextWithAnsi(text, width));
      } else {
        const blockLines = this.renderBlockToken(child, width);
        lines.push(...blockLines);
      }
    }

    return lines;
  }

  private renderTable(token: Tokens.Table, width: number): string[] {
    const borderColor = sgr(this.theme.tableBorderColor);
    const numCols = token.header.length;
    if (numCols === 0) return [];

    // Calculate column widths from content
    const colWidths = this.calculateColumnWidths(token, width, numCols);

    const lines: string[] = [];
    const bc = borderColor;
    const rst = RESET;

    // Top border: ╭──┬──╮
    lines.push(this.tableHorizontalLine(colWidths, bc, rst, BOX.topLeft, BOX.tTop, BOX.topRight));

    // Header row
    lines.push(this.tableRow(token.header, colWidths, token.align, bc, rst, true));

    // Header separator: ├══┼══┤ (thick)
    lines.push(this.tableThickLine(colWidths, bc, rst));

    // Data rows
    for (let r = 0; r < token.rows.length; r++) {
      lines.push(this.tableRow(token.rows[r]!, colWidths, token.align, bc, rst, false));
      if (r < token.rows.length - 1) {
        // Inter-row border: ├──┼──┤
        lines.push(this.tableHorizontalLine(colWidths, bc, rst, BOX.tLeft, BOX.cross, BOX.tRight));
      }
    }

    // Bottom border: ╰──┴──╯
    lines.push(this.tableHorizontalLine(colWidths, bc, rst, BOX.bottomLeft, BOX.tBottom, BOX.bottomRight));

    return lines;
  }

  private calculateColumnWidths(
    token: Tokens.Table,
    totalWidth: number,
    numCols: number,
  ): number[] {
    // Measure content widths
    const contentWidths: number[] = [];
    for (let c = 0; c < numCols; c++) {
      let maxW = visibleWidth(this.renderInlineTokens(token.header[c]!.tokens));
      for (const row of token.rows) {
        if (row[c]) {
          const w = visibleWidth(this.renderInlineTokens(row[c]!.tokens));
          if (w > maxW) maxW = w;
        }
      }
      contentWidths.push(maxW);
    }

    // Available width = total - borders (numCols+1 border chars) - padding (2 per col)
    const borderChars = numCols + 1;
    const paddingChars = numCols * 2; // 1 space each side
    const availableWidth = Math.max(numCols, totalWidth - borderChars - paddingChars);

    const totalContentWidth = contentWidths.reduce((a, b) => a + b, 0);

    if (totalContentWidth <= availableWidth) {
      // Distribute extra space evenly
      const extra = availableWidth - totalContentWidth;
      const extraPerCol = Math.floor(extra / numCols);
      return contentWidths.map((w) => w + extraPerCol);
    } else {
      // Shrink proportionally
      return contentWidths.map((w) =>
        Math.max(1, Math.floor((w / totalContentWidth) * availableWidth)),
      );
    }
  }

  private tableHorizontalLine(
    colWidths: number[],
    bc: string,
    rst: string,
    left: string,
    mid: string,
    right: string,
  ): string {
    const segments = colWidths.map(
      (w) => BOX.horizontal.repeat(w + 2), // +2 for padding
    );
    return `${bc}${left}${segments.join(mid)}${right}${rst}`;
  }

  private tableThickLine(colWidths: number[], bc: string, rst: string): string {
    const segments = colWidths.map(
      (w) => BOX.thickH.repeat(w + 2),
    );
    return `${bc}${BOX.tLeft}${segments.join(BOX.cross)}${BOX.tRight}${rst}`;
  }

  private tableRow(
    cells: Tokens.TableCell[],
    colWidths: number[],
    aligns: Array<'center' | 'left' | 'right' | null>,
    bc: string,
    rst: string,
    isHeader: boolean,
  ): string {
    const parts: string[] = [];
    for (let c = 0; c < colWidths.length; c++) {
      const cell = cells[c];
      const raw = cell ? this.renderInlineTokens(cell.tokens) : '';
      const content = isHeader ? this.theme.tableHeader(raw) : raw;
      const contentWidth = visibleWidth(content);
      const colWidth = colWidths[c]!;

      let padded: string;
      if (contentWidth >= colWidth) {
        padded = truncateToWidth(content, colWidth);
      } else {
        const align = aligns[c] ?? 'left';
        const space = colWidth - contentWidth;
        if (align === 'right') {
          padded = ' '.repeat(space) + content;
        } else if (align === 'center') {
          const leftPad = Math.floor(space / 2);
          const rightPad = space - leftPad;
          padded = ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
        } else {
          padded = content + ' '.repeat(space);
        }
      }

      parts.push(` ${padded} `);
    }

    return `${bc}${BOX.vertical}${rst}${parts.join(`${bc}${BOX.vertical}${rst}`)}${bc}${BOX.vertical}${rst}`;
  }

  private renderHr(width: number): string[] {
    const color = sgr(this.theme.hrColor);
    return [`${color}${BOX.horizontal.repeat(width)}${RESET}`];
  }

  private renderHtml(token: Tokens.HTML, width: number): string[] {
    // Render HTML blocks as dimmed plain text
    const text = token.text.replace(/<[^>]+>/g, '');
    if (!text.trim()) return [];
    return wrapTextWithAnsi(this.theme.dim(text.trim()), width);
  }

  // ── Inline rendering ────────────────────────────────────────────────────

  /** Render inline tokens to a single styled string. */
  private renderInlineTokens(tokens: Token[]): string {
    let result = '';
    for (const token of tokens) {
      result += this.renderInlineToken(token);
    }
    return result;
  }

  private renderInlineToken(token: Token): string {
    switch (token.type) {
      case 'text':
        return (token as Tokens.Text).text;
      case 'strong':
        return this.theme.bold(this.renderInlineTokens((token as Tokens.Strong).tokens));
      case 'em':
        return this.theme.italic(this.renderInlineTokens((token as Tokens.Em).tokens));
      case 'codespan':
        return this.theme.codeSpan(this.unescapeHtml((token as Tokens.Codespan).text));
      case 'del':
        return this.theme.strikethrough(this.renderInlineTokens((token as Tokens.Del).tokens));
      case 'link':
        return this.theme.link(
          this.renderInlineTokens((token as Tokens.Link).tokens),
          (token as Tokens.Link).href,
        );
      case 'image':
        return this.theme.dim(`[image: ${(token as Tokens.Image).text}]`);
      case 'br':
        return '\n';
      case 'escape':
        return (token as Tokens.Escape).text;
      case 'html':
        // Inline HTML — strip tags
        return (token as Tokens.HTML).text.replace(/<[^>]+>/g, '');
      default:
        if ('text' in token && typeof token.text === 'string') {
          return token.text;
        }
        return '';
    }
  }

  /** Unescape HTML entities in code spans (marked escapes them). */
  private unescapeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}

// ── Fallback default theme ──────────────────────────────────────────────────

/** Creates a minimal default theme (cyan accents, gray dim) for standalone use. */
function createDefaultTheme(): MarkdownTheme {
  return {
    heading: (text: string, depth: number) => {
      const color = depth <= 2 ? '\x1b[36m' : '\x1b[33m'; // cyan / yellow
      return `${color}${BOLD}${text}${RESET}`;
    },
    bold: (text: string) => `${BOLD}${text}${RESET}`,
    italic: (text: string) => `${ITALIC}${text}${RESET}`,
    codeSpan: (text: string) => `${DIM}${INVERSE} ${text} ${RESET}`,
    strikethrough: (text: string) => `${STRIKETHROUGH}${text}${RESET}`,
    link: (text: string, href: string) =>
      `${UNDERLINE}\x1b[36m${text}${RESET} \x1b[90m(${href})${RESET}`,
    blockquoteBorder: `\x1b[90m│${RESET}`,
    codeBorderColor: 'gray',
    codeTextColor: 'gray',
    tableBorderColor: 'gray',
    tableHeader: (text: string) => `${BOLD}${text}${RESET}`,
    hrColor: 'gray',
    dim: (text: string) => `\x1b[90m${text}${RESET}`,
  };
}

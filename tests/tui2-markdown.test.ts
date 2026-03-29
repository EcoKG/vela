/**
 * Tests for the Markdown renderer component.
 *
 * Exercises headings, paragraphs, code blocks, tables, lists,
 * blockquotes, horizontal rules, inline formatting, caching,
 * and the MarkdownTheme adapter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import { Markdown, createMarkdownTheme, type MarkdownTheme } from '../src/tui2/components/markdown.js';
import { darkPalette, lightPalette, type ThemePalette } from '../src/tui/theme.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip ANSI codes from all lines for content assertions. */
function strip(lines: string[]): string[] {
  return lines.map((l) => stripAnsi(l));
}

/** Render markdown at default width and strip ANSI. */
function renderStripped(md: string, width = 80): string[] {
  const component = new Markdown(md);
  return strip(component.render(width));
}

/** Render markdown at default width (raw, with ANSI). */
function renderRaw(md: string, width = 80): string[] {
  const component = new Markdown(md);
  return component.render(width);
}

// ── Constructor & basic ─────────────────────────────────────────────────────

describe('Markdown', () => {
  describe('constructor and basics', () => {
    it('should render empty string as empty array', () => {
      const md = new Markdown('');
      expect(md.render(80)).toEqual([]);
    });

    it('should render whitespace-only as empty array', () => {
      const md = new Markdown('   \n  \n  ');
      expect(md.render(80)).toEqual([]);
    });

    it('should accept text in constructor', () => {
      const md = new Markdown('Hello');
      const lines = strip(md.render(80));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('Hello');
    });

    it('should accept custom theme', () => {
      const theme = createMarkdownTheme(darkPalette);
      const md = new Markdown('# Title', theme);
      const lines = md.render(80);
      expect(lines.length).toBeGreaterThan(0);
      // Should contain ANSI codes from theme
      expect(lines[0]).toContain('\x1b[');
    });
  });

  // ── setText / setTheme / invalidate ─────────────────────────────────────

  describe('setText and cache', () => {
    it('should update content when setText is called', () => {
      const md = new Markdown('first');
      const lines1 = strip(md.render(80));
      expect(lines1[0]).toBe('first');

      md.setText('second');
      const lines2 = strip(md.render(80));
      expect(lines2[0]).toBe('second');
    });

    it('should return cached result when text and width unchanged', () => {
      const md = new Markdown('hello');
      const lines1 = md.render(80);
      const lines2 = md.render(80);
      expect(lines1).toBe(lines2); // Same reference = cached
    });

    it('should invalidate cache when width changes', () => {
      const md = new Markdown('hello');
      const lines1 = md.render(80);
      const lines2 = md.render(40);
      expect(lines1).not.toBe(lines2);
    });

    it('should not invalidate when setText called with same value', () => {
      const md = new Markdown('hello');
      const lines1 = md.render(80);
      md.setText('hello'); // same text
      const lines2 = md.render(80);
      expect(lines1).toBe(lines2); // Still cached
    });

    it('should invalidate cache via invalidate()', () => {
      const md = new Markdown('hello');
      const lines1 = md.render(80);
      md.invalidate();
      const lines2 = md.render(80);
      expect(lines1).not.toBe(lines2); // Different reference
      expect(strip(lines1)).toEqual(strip(lines2)); // Same content
    });
  });

  // ── Headings ────────────────────────────────────────────────────────────

  describe('headings', () => {
    it('should render h1 with # prefix', () => {
      const lines = renderStripped('# Hello World');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('# Hello World');
    });

    it('should render h2 with ## prefix', () => {
      const lines = renderStripped('## Section');
      expect(lines[0]).toBe('## Section');
    });

    it('should render h3-h6', () => {
      for (let d = 3; d <= 6; d++) {
        const prefix = '#'.repeat(d);
        const lines = renderStripped(`${prefix} Heading ${d}`);
        expect(lines[0]).toBe(`${prefix} Heading ${d}`);
      }
    });

    it('should apply ANSI styling to headings', () => {
      const raw = renderRaw('# Title');
      expect(raw[0]).toContain('\x1b['); // Has ANSI codes
      expect(raw[0]).toContain('\x1b[1m'); // Bold
    });

    it('should wrap long headings', () => {
      const longTitle = 'A'.repeat(100);
      const lines = renderStripped(`# ${longTitle}`, 40);
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  // ── Paragraphs ──────────────────────────────────────────────────────────

  describe('paragraphs', () => {
    it('should render simple paragraph', () => {
      const lines = renderStripped('Hello world');
      expect(lines).toEqual(['Hello world']);
    });

    it('should wrap paragraph at width', () => {
      const text = 'The quick brown fox jumps over the lazy dog and keeps running.';
      const lines = renderStripped(text, 30);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(30);
      }
    });

    it('should separate multiple paragraphs with blank line', () => {
      const lines = renderStripped('First paragraph.\n\nSecond paragraph.');
      expect(lines).toContain('');
      expect(lines[0]).toBe('First paragraph.');
      const secondIdx = lines.indexOf('Second paragraph.');
      expect(secondIdx).toBeGreaterThan(1);
    });
  });

  // ── Code blocks ─────────────────────────────────────────────────────────

  describe('code blocks', () => {
    it('should render fenced code with borders', () => {
      const lines = renderStripped('```\nconst x = 1;\n```');
      // Should have top border, content, bottom border
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toContain('╭');
      expect(lines[0]).toContain('╮');
      expect(lines[lines.length - 1]).toContain('╰');
      expect(lines[lines.length - 1]).toContain('╯');
    });

    it('should show language label', () => {
      const lines = renderStripped('```javascript\nconst x = 1;\n```');
      expect(lines[0]).toContain('javascript');
    });

    it('should render code content inside borders', () => {
      const lines = renderStripped('```\nline1\nline2\n```');
      // Middle lines should contain the code
      const contentLines = lines.slice(1, -1);
      const joined = contentLines.join('\n');
      expect(joined).toContain('line1');
      expect(joined).toContain('line2');
    });

    it('should have vertical borders on content lines', () => {
      const lines = renderStripped('```\nhello\n```');
      const contentLine = lines[1]!;
      expect(contentLine).toContain('│');
    });

    it('should wrap long code lines within borders', () => {
      const longLine = 'x'.repeat(200);
      const lines = renderStripped('```\n' + longLine + '\n```', 40);
      // Content lines should be wrapped, so more than 3 total lines
      expect(lines.length).toBeGreaterThan(3);
    });
  });

  // ── Blockquotes ─────────────────────────────────────────────────────────

  describe('blockquotes', () => {
    it('should render blockquote with border', () => {
      const lines = renderStripped('> Hello quote');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('│');
      expect(lines[0]).toContain('Hello quote');
    });

    it('should handle multi-line blockquotes', () => {
      const lines = renderStripped('> Line one\n> Line two');
      // All lines should have border prefix
      for (const line of lines) {
        expect(line).toContain('│');
      }
    });

    it('should wrap blockquote content', () => {
      const long = 'A '.repeat(50);
      const lines = renderStripped(`> ${long}`, 30);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line).toContain('│');
      }
    });
  });

  // ── Lists ───────────────────────────────────────────────────────────────

  describe('lists', () => {
    it('should render unordered list with bullets', () => {
      const lines = renderStripped('- item 1\n- item 2\n- item 3');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('•');
      expect(lines[0]).toContain('item 1');
      expect(lines[1]).toContain('•');
      expect(lines[2]).toContain('•');
    });

    it('should render ordered list with numbers', () => {
      const lines = renderStripped('1. first\n2. second\n3. third');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('1.');
      expect(lines[0]).toContain('first');
      expect(lines[1]).toContain('2.');
      expect(lines[2]).toContain('3.');
    });

    it('should handle nested lists', () => {
      const md = '- outer\n  - inner 1\n  - inner 2';
      const lines = renderStripped(md);
      // Should have items at different indent levels
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it('should wrap long list items', () => {
      const longText = 'word '.repeat(30);
      const lines = renderStripped(`- ${longText}`, 40);
      expect(lines.length).toBeGreaterThan(1);
      // First line has bullet
      expect(lines[0]).toContain('•');
    });

    it('should render task list items', () => {
      const md = '- [x] done\n- [ ] todo';
      const lines = renderStripped(md);
      expect(lines[0]).toContain('☑');
      expect(lines[0]).toContain('done');
      expect(lines[1]).toContain('☐');
      expect(lines[1]).toContain('todo');
    });

    it('should respect ordered list start number', () => {
      const md = '3. third\n4. fourth';
      const lines = renderStripped(md);
      expect(lines[0]).toContain('3.');
      expect(lines[1]).toContain('4.');
    });
  });

  // ── Tables ──────────────────────────────────────────────────────────────

  describe('tables', () => {
    const simpleMd = '| A | B |\n|---|---|\n| 1 | 2 |';

    it('should render table with box-drawing borders', () => {
      const lines = renderStripped(simpleMd);
      expect(lines.length).toBeGreaterThanOrEqual(5); // top + header + sep + row + bottom
      expect(lines[0]).toContain('╭');
      expect(lines[lines.length - 1]).toContain('╰');
    });

    it('should have header separator with thick lines', () => {
      const lines = renderStripped(simpleMd);
      const thickLine = lines.find((l) => l.includes('═'));
      expect(thickLine).toBeDefined();
    });

    it('should render header and data cells', () => {
      const lines = renderStripped(simpleMd);
      const joined = lines.join('\n');
      expect(joined).toContain('A');
      expect(joined).toContain('B');
      expect(joined).toContain('1');
      expect(joined).toContain('2');
    });

    it('should handle alignment', () => {
      const md = '| Left | Center | Right |\n|:-----|:------:|------:|\n| l | c | r |';
      const lines = renderStripped(md);
      expect(lines.length).toBeGreaterThanOrEqual(5);
      // Content should be present
      const joined = lines.join('\n');
      expect(joined).toContain('Left');
      expect(joined).toContain('Center');
      expect(joined).toContain('Right');
    });

    it('should handle multi-row tables', () => {
      const md = '| H1 | H2 |\n|---|---|\n| a | b |\n| c | d |';
      const lines = renderStripped(md);
      const joined = lines.join('\n');
      expect(joined).toContain('a');
      expect(joined).toContain('d');
      // Should have inter-row separator
      const separatorLines = lines.filter((l) => l.includes('├') || l.includes('┤'));
      expect(separatorLines.length).toBeGreaterThan(0);
    });
  });

  // ── Horizontal rules ───────────────────────────────────────────────────

  describe('horizontal rules', () => {
    it('should render hr as horizontal line', () => {
      const lines = renderStripped('---');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('─');
    });

    it('should fill width', () => {
      const lines = renderStripped('---', 40);
      const hrContent = lines[0]!;
      const dashCount = (hrContent.match(/─/g) || []).length;
      expect(dashCount).toBe(40);
    });
  });

  // ── Inline formatting ──────────────────────────────────────────────────

  describe('inline formatting', () => {
    it('should render bold text with ANSI bold', () => {
      const raw = renderRaw('**bold text**');
      expect(raw[0]).toContain('\x1b[1m'); // BOLD SGR
    });

    it('should render bold text content', () => {
      const lines = renderStripped('**bold text**');
      expect(lines[0]).toBe('bold text');
    });

    it('should render italic text with ANSI italic', () => {
      const raw = renderRaw('*italic text*');
      expect(raw[0]).toContain('\x1b[3m'); // ITALIC SGR
    });

    it('should render italic text content', () => {
      const lines = renderStripped('*italic text*');
      expect(lines[0]).toBe('italic text');
    });

    it('should render inline code with inverse', () => {
      const raw = renderRaw('use `console.log`');
      expect(raw[0]).toContain('\x1b[7m'); // INVERSE SGR
    });

    it('should render inline code content', () => {
      const lines = renderStripped('use `console.log`');
      expect(lines[0]).toContain('console.log');
    });

    it('should render strikethrough', () => {
      const raw = renderRaw('~~deleted~~');
      expect(raw[0]).toContain('\x1b[9m'); // STRIKETHROUGH SGR
    });

    it('should render strikethrough content', () => {
      const lines = renderStripped('~~deleted~~');
      expect(lines[0]).toBe('deleted');
    });

    it('should render links with text and href', () => {
      const lines = renderStripped('[click here](https://example.com)');
      expect(lines[0]).toContain('click here');
      expect(lines[0]).toContain('https://example.com');
    });

    it('should render links with ANSI underline', () => {
      const raw = renderRaw('[link](https://example.com)');
      expect(raw[0]).toContain('\x1b[4m'); // UNDERLINE SGR
    });

    it('should render images as alt text placeholder', () => {
      const lines = renderStripped('![alt text](image.png)');
      expect(lines[0]).toContain('[image: alt text]');
    });

    it('should handle mixed inline formatting', () => {
      const lines = renderStripped('This is **bold** and *italic* text');
      expect(lines[0]).toBe('This is bold and italic text');
    });

    it('should unescape HTML entities in code spans', () => {
      const lines = renderStripped('`a < b && c > d`');
      expect(lines[0]).toContain('a < b && c > d');
    });
  });

  // ── Mixed content ──────────────────────────────────────────────────────

  describe('mixed content', () => {
    it('should render heading + paragraph + list', () => {
      const md = '# Title\n\nSome text here.\n\n- item 1\n- item 2';
      const lines = renderStripped(md);
      const joined = lines.join('\n');
      expect(joined).toContain('# Title');
      expect(joined).toContain('Some text here.');
      expect(joined).toContain('item 1');
      expect(joined).toContain('item 2');
    });

    it('should separate blocks with blank lines', () => {
      const md = '# Title\n\nParagraph\n\n---';
      const lines = renderStripped(md);
      // Should have blank lines between blocks
      const blankCount = lines.filter((l) => l === '').length;
      expect(blankCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle real-world markdown', () => {
      const md = `# Getting Started

Install the package:

\`\`\`bash
npm install vela
\`\`\`

## Features

- **Fast** — built for speed
- *Flexible* — works anywhere
- ~~Deprecated~~ feature removed

| Command | Description |
|---------|-------------|
| \`start\` | Start the app |
| \`stop\` | Stop the app |

> Note: This is important.

---

For more info, visit [the docs](https://example.com).`;

      const lines = renderStripped(md, 60);
      const joined = lines.join('\n');

      // Verify all block types are present
      expect(joined).toContain('# Getting Started');
      expect(joined).toContain('Install the package');
      expect(joined).toContain('npm install vela');
      expect(joined).toContain('## Features');
      expect(joined).toContain('Fast');
      expect(joined).toContain('Flexible');
      expect(joined).toContain('Command');
      expect(joined).toContain('start');
      expect(joined).toContain('Note: This is important.');
      expect(joined).toContain('the docs');
      expect(joined).toContain('https://example.com');
      expect(joined).toContain('─'); // hr
    });
  });

  // ── createMarkdownTheme adapter ─────────────────────────────────────────

  describe('createMarkdownTheme', () => {
    it('should create theme from dark palette', () => {
      const theme = createMarkdownTheme(darkPalette);
      expect(theme.heading).toBeTypeOf('function');
      expect(theme.bold).toBeTypeOf('function');
      expect(theme.italic).toBeTypeOf('function');
      expect(theme.codeSpan).toBeTypeOf('function');
      expect(theme.strikethrough).toBeTypeOf('function');
      expect(theme.link).toBeTypeOf('function');
      expect(theme.dim).toBeTypeOf('function');
      expect(theme.tableHeader).toBeTypeOf('function');
    });

    it('should create theme from light palette', () => {
      const theme = createMarkdownTheme(lightPalette);
      expect(theme.heading).toBeTypeOf('function');
      // Light palette accent is 'blue', should produce blue ANSI
      const heading = theme.heading('Test', 1);
      expect(heading).toContain('\x1b[34m'); // blue
    });

    it('should apply bold to headings', () => {
      const theme = createMarkdownTheme(darkPalette);
      const h1 = theme.heading('Title', 1);
      expect(h1).toContain('\x1b[1m'); // bold
    });

    it('should use accent color for h1/h2', () => {
      const theme = createMarkdownTheme(darkPalette);
      const h1 = theme.heading('Title', 1);
      const h2 = theme.heading('Sub', 2);
      expect(h1).toContain('\x1b[36m'); // cyan (dark accent)
      expect(h2).toContain('\x1b[36m');
    });

    it('should use highlight color for h3+', () => {
      const theme = createMarkdownTheme(darkPalette);
      const h3 = theme.heading('Sub', 3);
      expect(h3).toContain('\x1b[33m'); // yellow (dark highlight)
    });

    it('should apply ANSI bold to bold text', () => {
      const theme = createMarkdownTheme(darkPalette);
      const bold = theme.bold('test');
      expect(bold).toContain('\x1b[1m');
      expect(bold).toContain('\x1b[0m'); // reset
    });

    it('should apply ANSI italic to italic text', () => {
      const theme = createMarkdownTheme(darkPalette);
      const italic = theme.italic('test');
      expect(italic).toContain('\x1b[3m');
    });

    it('should render code span with inverse', () => {
      const theme = createMarkdownTheme(darkPalette);
      const code = theme.codeSpan('test');
      expect(code).toContain('\x1b[7m'); // inverse
    });

    it('should render strikethrough', () => {
      const theme = createMarkdownTheme(darkPalette);
      const del = theme.strikethrough('test');
      expect(del).toContain('\x1b[9m');
    });

    it('should render links with underline and accent', () => {
      const theme = createMarkdownTheme(darkPalette);
      const link = theme.link('text', 'https://example.com');
      expect(link).toContain('\x1b[4m'); // underline
      expect(link).toContain('\x1b[36m'); // cyan
      expect(link).toContain('https://example.com');
    });

    it('should have string properties for color references', () => {
      const theme = createMarkdownTheme(darkPalette);
      expect(typeof theme.codeBorderColor).toBe('string');
      expect(typeof theme.codeTextColor).toBe('string');
      expect(typeof theme.tableBorderColor).toBe('string');
      expect(typeof theme.hrColor).toBe('string');
      expect(typeof theme.blockquoteBorder).toBe('string');
    });

    it('should use theme with Markdown component', () => {
      const theme = createMarkdownTheme(darkPalette);
      const md = new Markdown('**hello**', theme);
      const lines = md.render(80);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain('\x1b[1m'); // bold from theme
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle very narrow width', () => {
      const lines = renderStripped('Hello world', 5);
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should handle width of 1', () => {
      const md = new Markdown('Hi');
      // Should not throw
      const lines = md.render(1);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should handle empty code block', () => {
      const lines = renderStripped('```\n\n```');
      expect(lines.length).toBeGreaterThanOrEqual(3); // borders + empty line
    });

    it('should handle single-column table', () => {
      const md = '| A |\n|---|\n| 1 |';
      const lines = renderStripped(md);
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle HTML blocks (stripped)', () => {
      const md = '<div>some html</div>';
      const lines = renderStripped(md);
      if (lines.length > 0) {
        expect(lines[0]).toContain('some html');
      }
    });

    it('should handle line breaks in inline', () => {
      const md = 'Line one  \nLine two'; // two trailing spaces = <br>
      const lines = renderStripped(md);
      const joined = lines.join('\n');
      expect(joined).toContain('Line one');
      expect(joined).toContain('Line two');
    });

    it('should handle escaped characters', () => {
      const md = 'Use \\*asterisks\\* literally';
      const lines = renderStripped(md);
      expect(lines[0]).toContain('*asterisks*');
    });

    it('should setTheme and re-render', () => {
      const md = new Markdown('# Title');
      const lines1 = md.render(80);

      const lightTheme = createMarkdownTheme(lightPalette);
      md.setTheme(lightTheme);
      const lines2 = md.render(80);

      // Different themes should produce different ANSI codes
      expect(lines1).not.toBe(lines2);
    });
  });
});

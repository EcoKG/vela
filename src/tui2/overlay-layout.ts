/**
 * Overlay layout resolution, compositing, and rendering utilities.
 *
 * Pure functions that compute overlay positions and composite overlay content
 * onto base terminal lines. Ported from pi-tui overlay-layout.js.
 */

import {
  extractSegments,
  sliceByColumn,
  sliceWithWidth,
  visibleWidth,
} from "./utils.js";
import { isImageLine } from "./terminal-image.js";
import { CURSOR_MARKER } from "./tui.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A percentage string like "50%" or an absolute number. */
export type SizeValue = number | string;

/** Anchor position for overlays. */
export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Margin specification (uniform number or per-side). */
export interface MarginSpec {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Options controlling overlay position and size. */
export interface OverlayOptions {
  width?: SizeValue;
  minWidth?: number;
  maxHeight?: SizeValue;
  anchor?: Anchor;
  margin?: number | MarginSpec;
  row?: number | string;
  col?: number | string;
  offsetX?: number;
  offsetY?: number;
  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;
}

/** Renderable component that can participate in overlays. */
export interface OverlayComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  dispose?(): void;
  focused?: boolean;
  wantsKeyRelease?: boolean;
}

/** An entry on the overlay stack. */
export interface OverlayEntry {
  component: OverlayComponent;
  options?: OverlayOptions;
  preFocus: OverlayComponent | null;
  hidden: boolean;
  focusOrder: number;
}

/** Resolved overlay layout. */
export interface ResolvedLayout {
  width: number;
  row: number;
  col: number;
  maxHeight: number | undefined;
}

// ─── Size parsing ───────────────────────────────────────────────────────────

/** Parse a SizeValue into absolute value given a reference size. */
export function parseSizeValue(
  value: SizeValue | undefined,
  referenceSize: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) {
    return Math.floor((referenceSize * parseFloat(match[1]!)) / 100);
  }
  return undefined;
}

// ─── Anchor resolution ──────────────────────────────────────────────────────

export function resolveAnchorRow(
  anchor: Anchor,
  height: number,
  availHeight: number,
  marginTop: number,
): number {
  switch (anchor) {
    case "top-left":
    case "top-center":
    case "top-right":
      return marginTop;
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
      return marginTop + availHeight - height;
    case "left-center":
    case "center":
    case "right-center":
      return marginTop + Math.floor((availHeight - height) / 2);
  }
}

export function resolveAnchorCol(
  anchor: Anchor,
  width: number,
  availWidth: number,
  marginLeft: number,
): number {
  switch (anchor) {
    case "top-left":
    case "left-center":
    case "bottom-left":
      return marginLeft;
    case "top-right":
    case "right-center":
    case "bottom-right":
      return marginLeft + availWidth - width;
    case "top-center":
    case "center":
    case "bottom-center":
      return marginLeft + Math.floor((availWidth - width) / 2);
  }
}

/**
 * Resolve overlay layout from options.
 * Returns { width, row, col, maxHeight } for rendering.
 */
export function resolveOverlayLayout(
  options: OverlayOptions | undefined,
  overlayHeight: number,
  termWidth: number,
  termHeight: number,
): ResolvedLayout {
  const opt = options ?? {};

  // Parse margin (clamp to non-negative)
  const margin =
    typeof opt.margin === "number"
      ? {
          top: opt.margin,
          right: opt.margin,
          bottom: opt.margin,
          left: opt.margin,
        }
      : (opt.margin ?? {});
  const marginTop = Math.max(0, margin.top ?? 0);
  const marginRight = Math.max(0, margin.right ?? 0);
  const marginBottom = Math.max(0, margin.bottom ?? 0);
  const marginLeft = Math.max(0, margin.left ?? 0);

  // Available space after margins
  const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
  const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

  // === Resolve width ===
  let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
  if (opt.minWidth !== undefined) {
    width = Math.max(width, opt.minWidth);
  }
  width = Math.max(1, Math.min(width, availWidth));

  // === Resolve maxHeight ===
  let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
  if (maxHeight !== undefined) {
    maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
  }

  // Effective overlay height (may be clamped by maxHeight)
  const effectiveHeight =
    maxHeight !== undefined
      ? Math.min(overlayHeight, maxHeight)
      : overlayHeight;

  // === Resolve position ===
  let row: number;
  let col: number;

  if (opt.row !== undefined) {
    if (typeof opt.row === "string") {
      const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
      if (match) {
        const maxRow = Math.max(0, availHeight - effectiveHeight);
        const percent = parseFloat(match[1]!) / 100;
        row = marginTop + Math.floor(maxRow * percent);
      } else {
        row = resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
      }
    } else {
      row = opt.row;
    }
  } else {
    const anchor = opt.anchor ?? "center";
    row = resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
  }

  if (opt.col !== undefined) {
    if (typeof opt.col === "string") {
      const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
      if (match) {
        const maxCol = Math.max(0, availWidth - width);
        const percent = parseFloat(match[1]!) / 100;
        col = marginLeft + Math.floor(maxCol * percent);
      } else {
        col = resolveAnchorCol("center", width, availWidth, marginLeft);
      }
    } else {
      col = opt.col;
    }
  } else {
    const anchor = opt.anchor ?? "center";
    col = resolveAnchorCol(anchor, width, availWidth, marginLeft);
  }

  // Apply offsets
  if (opt.offsetY !== undefined) row += opt.offsetY;
  if (opt.offsetX !== undefined) col += opt.offsetX;

  // Clamp to terminal bounds (respecting margins)
  row = Math.max(
    marginTop,
    Math.min(row, termHeight - marginBottom - effectiveHeight),
  );
  col = Math.max(
    marginLeft,
    Math.min(col, termWidth - marginRight - width),
  );

  return { width, row, col, maxHeight };
}

// ─── Line compositing ───────────────────────────────────────────────────────

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

/** Append reset sequences to each non-image line. */
export function applyLineResets(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isImageLine(line)) {
      lines[i] = line + SEGMENT_RESET;
    }
  }
  return lines;
}

/**
 * Splice overlay content into a base line at a specific column.
 * Single-pass optimised.
 */
export function compositeLineAt(
  baseLine: string,
  overlayLine: string,
  startCol: number,
  overlayWidth: number,
  totalWidth: number,
): string {
  if (isImageLine(baseLine)) return baseLine;

  const afterStart = startCol + overlayWidth;
  const base = extractSegments(
    baseLine,
    startCol,
    afterStart,
    totalWidth - afterStart,
    true,
  );

  const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);

  const beforePad = Math.max(0, startCol - base.before.width);
  const overlayPad = Math.max(0, overlayWidth - overlay.width);

  const actualBeforeWidth = Math.max(startCol, base.before.width);
  const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
  const afterTarget = Math.max(
    0,
    totalWidth - actualBeforeWidth - actualOverlayWidth,
  );
  const afterPad = Math.max(0, afterTarget - base.after.width);

  const r = SEGMENT_RESET;
  const result =
    base.before.text +
    " ".repeat(beforePad) +
    r +
    overlay.text +
    " ".repeat(overlayPad) +
    r +
    base.after.text +
    " ".repeat(afterPad);

  // Final safeguard: truncate to terminal width
  const resultWidth = visibleWidth(result);
  if (resultWidth <= totalWidth) {
    return result;
  }
  return sliceByColumn(result, 0, totalWidth, true);
}

/** Check if an overlay entry is currently visible. */
export function isOverlayVisible(
  entry: OverlayEntry,
  termWidth: number,
  termHeight: number,
): boolean {
  if (entry.hidden) return false;
  if (entry.options?.visible) {
    return entry.options.visible(termWidth, termHeight);
  }
  return true;
}

/**
 * Composite all visible overlays into content lines.
 * Sorted by focusOrder (higher = on top).
 */
export function compositeOverlays(
  lines: string[],
  overlayStack: OverlayEntry[],
  termWidth: number,
  termHeight: number,
  maxLinesRendered: number,
): string[] {
  if (overlayStack.length === 0) return lines;

  const result = [...lines];

  // Pre-render all visible overlays
  const rendered: Array<{
    overlayLines: string[];
    row: number;
    col: number;
    w: number;
  }> = [];
  let minLinesNeeded = result.length;

  const visibleEntries = overlayStack.filter((e) =>
    isOverlayVisible(e, termWidth, termHeight),
  );
  visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);

  for (const entry of visibleEntries) {
    const { component, options } = entry;

    // Resolve width/maxHeight first (don't depend on overlay height)
    const { width, maxHeight } = resolveOverlayLayout(
      options,
      0,
      termWidth,
      termHeight,
    );

    let overlayLines = component.render(width);
    if (maxHeight !== undefined && overlayLines.length > maxHeight) {
      overlayLines = overlayLines.slice(0, maxHeight);
    }

    const { row, col } = resolveOverlayLayout(
      options,
      overlayLines.length,
      termWidth,
      termHeight,
    );

    rendered.push({ overlayLines, row, col, w: width });
    minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
  }

  // Ensure result covers the terminal working area
  const workingHeight = Math.max(maxLinesRendered, minLinesNeeded);
  while (result.length < workingHeight) {
    result.push("");
  }

  const viewportStart = Math.max(0, workingHeight - termHeight);

  // Composite each overlay
  for (const { overlayLines, row, col, w } of rendered) {
    for (let i = 0; i < overlayLines.length; i++) {
      const idx = viewportStart + row + i;
      if (idx >= 0 && idx < result.length) {
        const truncatedOverlayLine =
          visibleWidth(overlayLines[i]!) > w
            ? sliceByColumn(overlayLines[i]!, 0, w, true)
            : overlayLines[i]!;
        result[idx] = compositeLineAt(
          result[idx]!,
          truncatedOverlayLine,
          col,
          w,
          termWidth,
        );
      }
    }
  }

  return result;
}

// ─── Cursor extraction ──────────────────────────────────────────────────────

/**
 * Find and extract cursor position from rendered lines.
 * Searches for CURSOR_MARKER, calculates its position, and strips it.
 * Only scans the bottom terminal-height lines (visible viewport).
 */
export function extractCursorPosition(
  lines: string[],
  height: number,
): { row: number; col: number } | null {
  const viewportTop = Math.max(0, lines.length - height);

  for (let row = lines.length - 1; row >= viewportTop; row--) {
    const line = lines[row]!;
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex !== -1) {
      const beforeMarker = line.slice(0, markerIndex);
      const col = visibleWidth(beforeMarker);
      lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
      return { row, col };
    }
  }
  return null;
}

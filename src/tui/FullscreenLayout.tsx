import React from 'react';
import { Box } from 'ink';
import { useScreenSize } from 'fullscreen-ink';

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_ROWS = 24;

// ── Props ─────────────────────────────────────────────────────

export interface FullscreenLayoutProps {
  /** Content rendered in the fixed-height header region. */
  header: React.ReactNode;
  /** Content rendered in the flexible-height body region. */
  body: React.ReactNode;
  /** Content rendered in the fixed-height input region. */
  input: React.ReactNode;
  /** Optional sidebar content rendered to the right of the body. */
  sidebar?: React.ReactNode;
  /** Whether the sidebar is visible. Default: false */
  sidebarVisible?: boolean;
  /** Fixed height for the header region (rows). Default: 3 */
  headerHeight?: number;
  /** Fixed height for the input region (rows). Default: 3 */
  inputHeight?: number;
}

// ── Layout Calculation ────────────────────────────────────────

export interface LayoutDimensions {
  contentWidth: number;
  marginLeft: number;
  headerHeight: number;
  bodyHeight: number;
  inputHeight: number;
  totalRows: number;
  /** Width of the main content area (contentWidth minus sidebar when visible). */
  mainWidth: number;
  /** Width of the sidebar panel (0 when hidden or terminal too narrow). */
  sidebarWidth: number;
}

/** Minimum terminal width required to show the sidebar. */
const MIN_SIDEBAR_COLS = 80;
/** Default sidebar width in columns. */
const DEFAULT_SIDEBAR_WIDTH = 34;

/**
 * Pure function that computes layout dimensions from screen size and config.
 * Uses the full terminal width — no max-width cap.
 */
export function computeLayout(
  columns: number | undefined,
  rows: number | undefined,
  headerHeight: number,
  inputHeight: number,
  sidebarVisible?: boolean,
  sidebarWidth?: number,
): LayoutDimensions {
  const effectiveColumns = columns ?? 120;
  const effectiveRows = rows ?? DEFAULT_ROWS;

  // Use full terminal width — no max-width restriction
  const contentWidth = effectiveColumns;
  const marginLeft = 0;
  const bodyHeight = Math.max(effectiveRows - headerHeight - inputHeight, 1);

  // Sidebar: show only when explicitly visible AND terminal is wide enough
  const showSidebar = sidebarVisible === true && effectiveColumns >= MIN_SIDEBAR_COLS;
  const actualSidebarWidth = showSidebar ? (sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH) : 0;
  const mainWidth = contentWidth - actualSidebarWidth;

  return {
    contentWidth,
    marginLeft,
    headerHeight,
    bodyHeight,
    inputHeight,
    totalRows: effectiveRows,
    mainWidth,
    sidebarWidth: actualSidebarWidth,
  };
}

// ── Component ─────────────────────────────────────────────────

/**
 * 3-panel fullscreen layout with fixed header/input and flexible body.
 * Uses the full terminal width for maximum space utilization.
 */
export function FullscreenLayout({
  header,
  body,
  input,
  sidebar,
  sidebarVisible = false,
  headerHeight: headerH = 3,
  inputHeight: inputH = 3,
}: FullscreenLayoutProps) {
  const { width: columns, height: rows } = useScreenSize();

  const layout = computeLayout(
    columns,
    rows,
    headerH,
    inputH,
    sidebarVisible,
  );

  const showSidebar = sidebarVisible && layout.sidebarWidth > 0 && sidebar != null;

  return (
    <Box
      flexDirection="column"
      height={layout.totalRows}
      width={layout.contentWidth}
    >
      {/* Header region — fixed height */}
      <Box height={layout.headerHeight} flexShrink={0}>
        {header}
      </Box>

      {/* Body region — fills remaining space, overflow hidden */}
      <Box height={layout.bodyHeight} overflow="hidden" flexGrow={1}>
        {showSidebar ? (
          <Box flexDirection="row" width={layout.contentWidth}>
            <Box width={layout.mainWidth} overflow="hidden">{body}</Box>
            <Box width={layout.sidebarWidth}>{sidebar}</Box>
          </Box>
        ) : (
          body
        )}
      </Box>

      {/* Input region — fixed height */}
      <Box height={layout.inputHeight} flexShrink={0}>
        {input}
      </Box>
    </Box>
  );
}
